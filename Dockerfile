# --- build: expo static export ---
FROM node:22-alpine AS build
WORKDIR /app

# package.json / package-lock.json 만 먼저 복사하고 npm ci 를 돌린 뒤에 소스를 복사한다.
# 이 순서여야 소스만 고친 빌드에서 의존성 설치 레이어가 캐시로 재사용된다.
# `COPY . .` 를 앞에 두면 파일 하나만 바뀌어도 npm ci 가 매번 처음부터 다시 돈다.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# 🔴 EXPO_PUBLIC_* 는 **빌드 시점에 번들 안으로 인라인된다.**
# Cloud Run 의 환경변수로는 절대 반영되지 않는다 — 이미 만들어진 정적 파일을 nginx 가
# 그대로 내보낼 뿐이라, 서비스 환경변수를 고쳐도 브라우저가 받는 값은 그대로다.
# 값이 바뀌면 이미지를 다시 빌드해야 한다. 값은 cloudbuild.yaml 의 substitution 으로 들어온다.
ARG EXPO_PUBLIC_API_URL=https://jayeon-api.redhead.kr
ARG EXPO_PUBLIC_ENV=production
ARG EXPO_PUBLIC_WEBVIEW_URL=https://jayeon.redhead.kr

ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL \
    EXPO_PUBLIC_ENV=$EXPO_PUBLIC_ENV \
    EXPO_PUBLIC_WEBVIEW_URL=$EXPO_PUBLIC_WEBVIEW_URL

RUN npx expo export --platform web

# --- serve: nginx on Cloud Run ($PORT=8080) ---
FROM nginx:alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080

import { RecipientTableToolbar } from './recipient-table-toolbar';
import { ReservedMark } from './reserved-mark';
import { formatPhone } from '@/lib/phone';
import { useRef, useState } from 'react';
import type { CSSProperties, DragEvent, KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { colors, fonts, text } from '@/constants/theme';
import { recipientSentSummary, useRecipientTableColumns } from './recipient-table-columns';
import { clampRecipientColumnWidth, defaultRecipientColumnWidth, recipientCustomFieldName } from '@/lib/recipient-columns';
import { ariaSort, customSortKey, sortHeaderLabel, sortIndicator, type RecipientSort } from './recipient-table-sort';
import type { RecipientTableProps } from './recipient-table-types';
import type { Recipient } from '@/types/sms';

const cell: CSSProperties = {
  padding: '10px 12px',
  borderRight: `1px solid ${colors.border}`,
  borderBottom: `1px solid ${colors.border}`,
  textAlign: 'left',
  height: 48,
  boxSizing: 'border-box',
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
};
const heading: CSSProperties = {
  ...cell,
  position: 'sticky',
  top: 0,
  zIndex: 1,
  backgroundColor: colors.bg,
  ...fonts.bodySemi,
};
const checkbox: CSSProperties = { width: 18, height: 18, margin: 0, accentColor: colors.greenText, cursor: 'pointer' };
const link: CSSProperties = { border: 0, padding: 0, background: 'transparent', color: colors.greenText, font: 'inherit', textAlign: 'left', overflowWrap: 'anywhere', textDecoration: 'underline', cursor: 'pointer' };
// 한 줄 목록: 줄바꿈 대신 말줄임으로 한 사람을 한 줄 높이에 둔다.
const oneLineText: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', overflowWrap: 'normal' };
// 제목 전체를 누를 수 있게 칸을 채우되 글자 모양은 제목 그대로 둔다.
const sortButton: CSSProperties = { display: 'flex', alignItems: 'center', gap: 3, width: '100%', minWidth: 0, border: 0, padding: 0, margin: 0, background: 'transparent', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer' };
const sortArrow: CSSProperties = { flexShrink: 0, fontSize: '0.7em', color: colors.greenText };
// 순서 손잡이. 제목 글자와 겹치지 않게 작게 두고, 잡는 곳임을 커서로 알린다.
const grip: CSSProperties = { flexShrink: 0, border: 0, padding: 0, margin: 0, background: 'transparent', color: colors.mid, font: 'inherit', fontSize: '0.85em', lineHeight: 1, cursor: 'grab' };
// 너비 손잡이. 칸 오른쪽 경계에 겹쳐 두어 표 선 자체를 잡아 끄는 느낌을 준다.
const resizeGrip: CSSProperties = { position: 'absolute', top: 0, right: -3, width: 6, height: '100%', border: 0, padding: 0, background: 'transparent', cursor: 'col-resize', touchAction: 'none', zIndex: 2 };

/** 고정 열의 제목. 사용자 정의 열은 열 이름이 곧 제목이다. */
const FIXED_LABELS: Record<string, string> = { phone: '전화번호', group: '그룹', sent: '발송건수' };
const columnLabel = (id: string) => FIXED_LABELS[id] ?? recipientCustomFieldName(id);

/** 웹에서는 실제 표 구조로 열의 의미와 키보드 조작을 제공한다. */
export function RecipientTable({ items, selectedIds, onSelectionChange, onHistory, disabled, onEdit, onRemove, includeSentFilter, reservedIds, dense = false }: RecipientTableProps) {
  const { allInfo, compact, setAllInfo, fields, rows, sort, toggleSort, columnOrder, columnWidths, customized, moveColumn, resizeColumn, resetColumns } = useRecipientTableColumns(items);
  const actions = !!onRemove;
  // 관리 열이 있는 수신자 관리 화면은 기존 간단뷰를 유지한다.
  const oneLine = dense && compact && !actions;
  /**
   * 🔴 순서·너비 조정은 **전체보기에서만** 산다. 좁은 보기는 백분율 폭과 열 생략으로 그 화면에
   * 맞춰 둔 것이라, 저장된 px 너비를 얹으면 표가 화면 밖으로 밀려 나간다.
   */
  const adjustable = !compact && !oneLine;
  const checkWidth = oneLine ? 36 : compact ? 28 : 48;
  const fixedCheck: CSSProperties = { position: 'sticky', left: 0, zIndex: 2, backgroundColor: 'inherit' };
  const fixedName: CSSProperties = { position: 'sticky', left: checkWidth, zIndex: 2, backgroundColor: 'inherit', boxShadow: '2px 0 3px rgba(0, 0, 0, 0.08)' };
  const cellStyle: CSSProperties = oneLine ? { ...cell, ...oneLineText, padding: '0 6px', height: 44, fontSize: text.md } : compact ? { ...cell, padding: '8px 4px', fontSize: text.base } : cell;
  const headingStyle: CSSProperties = oneLine ? { ...heading, ...oneLineText, padding: '0 6px', height: 40, fontSize: text.md } : compact ? { ...heading, padding: '8px 4px', fontSize: text.base } : heading;
  const linkStyle: CSSProperties = oneLine ? { ...link, ...oneLineText, display: 'block', maxWidth: '100%' } : link;
  /**
   * 🔴 제목과 본문이 **이 한 배열**을 함께 돈다. 두 곳에 따로 나열해 두면 순서가 한쪽만 바뀌는
   * 순간 값이 옆 칸에 찍히는데, 화면만 봐서는 그게 「이 사람 전화번호가 이상하네」로 읽힌다.
   */
  const columnIds = adjustable ? columnOrder : ['phone', ...(oneLine ? [] : ['group']), 'sent', ...fields.map(customSortKey)];
  // 끄는 동안에는 저장하지 않고 화면에만 반영한다(→ `onPointerUp` 에서 한 번 저장).
  const [dragWidth, setDragWidth] = useState<{ id: string; width: number } | null>(null);
  const resizing = useRef<{ id: string; startX: number; startWidth: number } | null>(null);
  const widthOf = (id: string): number | string | undefined => {
    if (adjustable) return dragWidth?.id === id ? dragWidth.width : columnWidths[id];
    if (id === 'phone') return oneLine ? 112 : '25%';
    if (id === 'group') return '14%';
    if (id === 'sent') return undefined;
    return undefined;
  };
  const startResize = (id: string) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startWidth = columnWidths[id] ?? defaultRecipientColumnWidth(id);
    resizing.current = { id, startX: event.clientX, startWidth };
    setDragWidth({ id, width: startWidth });
  };
  const widthAt = (clientX: number) => {
    const state = resizing.current!;
    return clampRecipientColumnWidth(state.startWidth + clientX - state.startX);
  };
  const moveResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!resizing.current) return;
    setDragWidth({ id: resizing.current.id, width: widthAt(event.clientX) });
  };
  const endResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!resizing.current) return;
    const { id } = resizing.current;
    const width = widthAt(event.clientX);
    resizing.current = null;
    setDragWidth(null);
    resizeColumn(id, width);
  };
  const visibleIds = rows.map((item) => item.id);
  const selectedCount = visibleIds.filter((id) => selectedIds.includes(id)).length;
  const all = rows.length > 0 && selectedCount === rows.length;
  const mixed = selectedCount > 0 && !all;
  return (
    // dense 는 부모 세로 flex 의 남은 높이를 채우고, 표 영역만 스크롤해 제목 행과 이름 열을 고정한다.
    <div style={dense ? { width: '100%', flex: '1 1 0px', minHeight: 0, display: 'flex', flexDirection: 'column' } : { width: '100%' }}>
      <RecipientTableToolbar dense={dense} total={items.length} selectedCount={selectedIds.length} allInfo={allInfo} onViewChange={setAllInfo} includeSentFilter={includeSentFilter} onResetColumns={adjustable && customized ? resetColumns : undefined} />
    <div style={{ width: '100%', overflowX: 'auto', border: `1px solid ${colors.borderPill}`, backgroundColor: colors.card, ...(dense ? { flex: '1 1 0px', minHeight: 132, overflowY: 'auto', boxSizing: 'border-box' } : null) }}>
      <table aria-label="발송 수신자 목록" style={{ width: '100%', minWidth: compact ? undefined : 600 + fields.length * 90 + (actions ? 140 : 0), borderSpacing: 0, tableLayout: 'fixed', color: colors.ink, ...fonts.body, fontSize: text.md }}>
        <thead>
          <tr>
            <th scope="col" style={{ ...headingStyle, ...fixedCheck, top: 0, zIndex: 4, backgroundColor: colors.bg, width: checkWidth, textAlign: 'center' }}>
              <input type="checkbox" aria-label="전체 선택" aria-checked={mixed ? 'mixed' : all} checked={all} ref={(node) => { if (node) node.indeterminate = mixed; }} disabled={disabled || !rows.length} style={checkbox} onChange={() => onSelectionChange(all ? selectedIds.filter((id) => !visibleIds.includes(id)) : [...new Set([...selectedIds, ...visibleIds])])} />
            </th>
            {/* 이름은 옮기지도 늘리지도 않는다 — 체크박스와 함께 왼쪽에 고정된 열이다. */}
            <SortableHeading label="이름" sortKey="name" sort={sort} onToggle={toggleSort} style={{ ...headingStyle, ...fixedName, top: 0, zIndex: 4, backgroundColor: colors.bg, width: oneLine ? '28%' : compact ? '17%' : 95 }} />
            {columnIds.map((id, index) => (
              <SortableHeading
                key={id}
                label={columnLabel(id)}
                sortKey={id}
                sort={sort}
                onToggle={toggleSort}
                style={{ ...headingStyle, width: widthOf(id) }}
                adjust={adjustable ? {
                  onMoveBy: (delta: number) => moveColumn(id, index + delta),
                  onDropColumn: (dragged: string) => { if (dragged !== id) moveColumn(dragged, index); },
                  onResizeStart: startResize(id),
                  onResizeMove: moveResize,
                  onResizeEnd: endResize,
                  onResetWidth: () => resizeColumn(id, defaultRecipientColumnWidth(id)),
                } : undefined}
              />
            ))}
            {actions ? <th scope="col" style={{ ...headingStyle, width: compact ? 44 : 140 }}>관리</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={item.id} style={{ backgroundColor: selectedIds.includes(item.id) ? colors.sageRow : index % 2 ? colors.bg : colors.card }}>
              <td style={{ ...cellStyle, ...fixedCheck, textAlign: 'center' }}>
                <input type="checkbox" aria-label={`${item.name} · ${formatPhone(item.phone)}${item.groupId ? ` · ${item.groupId}` : ''}`} checked={selectedIds.includes(item.id)} disabled={disabled} style={checkbox} onChange={() => onSelectionChange(selectedIds.includes(item.id) ? selectedIds.filter((id) => id !== item.id) : [...selectedIds, item.id])} />
              </td>
              <td style={{ ...cellStyle, ...fixedName }} title={item.name}>
                {/* 예약 표시는 이름 왼쪽에 붙이되 이름의 말줄임 처리를 방해하지 않게 가로로 나눠 놓는다. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                  {reservedIds?.has(item.id) ? <ReservedMark size={oneLine ? 13 : 14} /> : null}
                  <span style={{ flex: '1 1 auto', minWidth: 0, ...(oneLine ? oneLineText : null) }}>
                    {onEdit && !actions ? <button type="button" aria-label={`${item.name} 수정`} disabled={disabled} onClick={() => onEdit(item)} style={linkStyle}>{item.name}</button> : item.name}
                  </span>
                </div>
              </td>
              {columnIds.map((id) => (
                <td key={id} style={cellStyle} title={id === 'group' ? item.groupId : undefined}>
                  {renderCell(id, item, { oneLine, linkStyle, onHistory })}
                </td>
              ))}
              {actions ? <td style={cellStyle}><div style={{ display: 'flex', gap: compact ? 6 : 12, flexWrap: 'wrap' }}>
                {onEdit ? <button type="button" aria-label={`${item.name} 수정`} disabled={disabled} onClick={() => onEdit(item)} style={{ color: colors.greenText, font: 'inherit', cursor: 'pointer' }}>수정</button> : null}
                {onRemove ? <button type="button" aria-label={`${item.name} 삭제`} disabled={disabled} onClick={() => onRemove(item)} style={{ color: colors.red, font: 'inherit', cursor: 'pointer' }}>삭제</button> : null}
              </div></td> : null}
            </tr>
          ))}
          {!rows.length ? <tr><td colSpan={2 + columnIds.length + (actions ? 1 : 0)} style={{ ...cellStyle, padding: 24, ...(oneLine ? { height: 'auto', whiteSpace: 'normal' } : null), textAlign: 'center', color: colors.mid }}>조건에 맞는 수신자가 없습니다.</td></tr> : null}
        </tbody>
      </table>
    </div>
    </div>
  );
}

/** 한 칸의 내용. 제목과 같은 식별자로 고르므로 열이 옮겨져도 값이 따라간다. */
function renderCell(id: string, item: Recipient, view: { oneLine: boolean; linkStyle: CSSProperties; onHistory: RecipientTableProps['onHistory'] }): ReactNode {
  if (id === 'phone') return formatPhone(item.phone);
  if (id === 'group') return item.groupId || '—';
  if (id === 'sent') {
    if (!item.sentCount) return null;
    return <button type="button" aria-label={`${item.name} 발송 이력 보기`} title={view.oneLine ? recipientSentSummary(item) : undefined} onClick={() => view.onHistory(item)} style={view.linkStyle}>
      {recipientSentSummary(item, view.oneLine)}
    </button>;
  }
  return item.customFields?.find((field) => field.name === recipientCustomFieldName(id))?.value || '—';
}

/** 열을 옮기고 늘리는 조작. 전체보기에서만 들어온다. */
type ColumnAdjust = {
  onMoveBy: (delta: number) => void;
  onDropColumn: (draggedId: string) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResetWidth: () => void;
};

/** 제목을 눌러 그 열로 정렬한다(누를 때마다 오름/내림 토글). */
function SortableHeading({ label, sortKey, sort, onToggle, style, adjust }: { label: string; sortKey: string; sort: RecipientSort; onToggle: (key: string) => void; style: CSSProperties; adjust?: ColumnAdjust }) {
  const arrow = sortIndicator(sort, sortKey);
  const sortLabel = sortHeaderLabel(label, sort, sortKey);
  return (
    <th
      scope="col"
      aria-sort={ariaSort(sort, sortKey)}
      // ⚠️ 제목은 `position: sticky` 다. 너비 손잡이의 기준점은 sticky 가 그대로 맡으므로
      // relative 로 바꾸지 마라 — 바꾸면 세로 스크롤에서 제목 행 고정이 풀린다.
      style={style}
      onDragOver={adjust ? (event: DragEvent<HTMLTableCellElement>) => event.preventDefault() : undefined}
      onDrop={adjust ? (event: DragEvent<HTMLTableCellElement>) => {
        event.preventDefault();
        const dragged = event.dataTransfer.getData('text/plain');
        if (dragged) adjust.onDropColumn(dragged);
      } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
        {adjust ? (
          /**
           * 🔴 손잡이에만 `draggable` 을 준다. 제목 전체는 이미 정렬 버튼이라, 제목을 끌 수 있게
           * 만들면 「정렬하려고 눌렀는데 열이 옮겨지는」 충돌이 생긴다.
           * ⚠️ 끌기를 못 쓰는 사람을 위해 ←/→ 로도 옮긴다.
           */
          <button
            type="button"
            draggable={true}
            aria-label={`${label} 열 위치 바꾸기`}
            title={`${label} 열 위치 바꾸기 (끌거나 ← →)`}
            style={grip}
            onDragStart={(event: DragEvent<HTMLButtonElement>) => {
              event.dataTransfer.setData('text/plain', sortKey);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              adjust.onMoveBy(event.key === 'ArrowLeft' ? -1 : 1);
            }}>
            ⠿
          </button>
        ) : null}
        <button type="button" aria-label={sortLabel} title={label} onClick={() => onToggle(sortKey)} style={sortButton}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
          {arrow ? <span aria-hidden={true} style={sortArrow}>{arrow}</span> : null}
        </button>
      </div>
      {adjust ? (
        <button
          type="button"
          aria-label={`${label} 열 너비 조절`}
          title="끌어서 너비 조절 · 두 번 누르면 기본 너비"
          style={resizeGrip}
          onPointerDown={adjust.onResizeStart}
          onPointerMove={adjust.onResizeMove}
          onPointerUp={adjust.onResizeEnd}
          onDoubleClick={adjust.onResetWidth}
        />
      ) : null}
    </th>
  );
}

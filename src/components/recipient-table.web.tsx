import { RecipientTableToolbar } from './recipient-table-toolbar';
import { formatPhone } from '@/lib/phone';
import type { CSSProperties } from 'react';
import { colors, fonts, text } from '@/constants/theme';
import { recipientSentSummary, useRecipientTableColumns } from './recipient-table-columns';
import type { RecipientTableProps } from './recipient-table-types';

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

/** 웹에서는 실제 표 구조로 열의 의미와 키보드 조작을 제공한다. */
export function RecipientTable({ items, selectedIds, onSelectionChange, onHistory, disabled, onEdit, onRemove, includeSentFilter, dense = false }: RecipientTableProps) {
  const { allInfo, compact, setAllInfo, fields } = useRecipientTableColumns(items);
  const actions = !!onRemove;
  // 관리 열이 있는 수신자 관리 화면은 기존 간단뷰를 유지한다.
  const oneLine = dense && compact && !actions;
  const checkWidth = oneLine ? 36 : compact ? 28 : 48;
  const fixedCheck: CSSProperties = { position: 'sticky', left: 0, zIndex: 2, backgroundColor: 'inherit' };
  const fixedName: CSSProperties = { position: 'sticky', left: checkWidth, zIndex: 2, backgroundColor: 'inherit', boxShadow: '2px 0 3px rgba(0, 0, 0, 0.08)' };
  const cellStyle: CSSProperties = oneLine ? { ...cell, ...oneLineText, padding: '0 6px', height: 44, fontSize: text.md } : compact ? { ...cell, padding: '8px 4px', fontSize: text.base } : cell;
  const headingStyle: CSSProperties = oneLine ? { ...heading, ...oneLineText, padding: '0 6px', height: 40, fontSize: text.md } : compact ? { ...heading, padding: '8px 4px', fontSize: text.base } : heading;
  const linkStyle: CSSProperties = oneLine ? { ...link, ...oneLineText, display: 'block', maxWidth: '100%' } : link;
  const visibleIds = items.map((item) => item.id);
  const selectedCount = visibleIds.filter((id) => selectedIds.includes(id)).length;
  const all = items.length > 0 && selectedCount === items.length;
  const mixed = selectedCount > 0 && !all;
  return (
    // dense 는 부모 세로 flex 의 남은 높이를 채우고, 표 영역만 스크롤해 제목 행과 이름 열을 고정한다.
    <div style={dense ? { width: '100%', flex: '1 1 0px', minHeight: 0, display: 'flex', flexDirection: 'column' } : { width: '100%' }}>
      <RecipientTableToolbar dense={dense} total={items.length} selectedCount={selectedIds.length} allInfo={allInfo} onViewChange={setAllInfo} includeSentFilter={includeSentFilter} />
    <div style={{ width: '100%', overflowX: 'auto', border: `1px solid ${colors.borderPill}`, backgroundColor: colors.card, ...(dense ? { flex: '1 1 0px', minHeight: 132, overflowY: 'auto', boxSizing: 'border-box' } : null) }}>
      <table aria-label="발송 수신자 목록" style={{ width: '100%', minWidth: compact ? undefined : 600 + fields.length * 90 + (actions ? 140 : 0), borderSpacing: 0, tableLayout: 'fixed', color: colors.ink, ...fonts.body, fontSize: text.md }}>
        <thead>
          <tr>
            <th scope="col" style={{ ...headingStyle, ...fixedCheck, top: 0, zIndex: 4, backgroundColor: colors.bg, width: checkWidth, textAlign: 'center' }}>
              <input type="checkbox" aria-label="전체 선택" aria-checked={mixed ? 'mixed' : all} checked={all} ref={(node) => { if (node) node.indeterminate = mixed; }} disabled={disabled || !items.length} style={checkbox} onChange={() => onSelectionChange(all ? selectedIds.filter((id) => !visibleIds.includes(id)) : [...new Set([...selectedIds, ...visibleIds])])} />
            </th>
            <th scope="col" style={{ ...headingStyle, ...fixedName, top: 0, zIndex: 4, backgroundColor: colors.bg, width: oneLine ? '28%' : compact ? '17%' : 95 }}>이름</th>
            <th scope="col" style={{ ...headingStyle, width: oneLine ? 112 : compact ? '25%' : 140 }}>전화번호</th>
            {oneLine ? null : <th scope="col" style={{ ...headingStyle, width: compact ? '14%' : 95 }}>그룹</th>}
            <th scope="col" style={{ ...headingStyle, width: compact || !fields.length ? undefined : 210 }}>발송건수</th>
            {fields.map((name) => <th key={name} scope="col" style={headingStyle}>{name}</th>)}
            {actions ? <th scope="col" style={{ ...headingStyle, width: compact ? 44 : 140 }}>관리</th> : null}
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id} style={{ backgroundColor: selectedIds.includes(item.id) ? colors.sageRow : index % 2 ? colors.bg : colors.card }}>
              <td style={{ ...cellStyle, ...fixedCheck, textAlign: 'center' }}>
                <input type="checkbox" aria-label={`${item.name} · ${formatPhone(item.phone)}${item.groupId ? ` · ${item.groupId}` : ''}`} checked={selectedIds.includes(item.id)} disabled={disabled} style={checkbox} onChange={() => onSelectionChange(selectedIds.includes(item.id) ? selectedIds.filter((id) => id !== item.id) : [...selectedIds, item.id])} />
              </td>
              <td style={{ ...cellStyle, ...fixedName }} title={item.name}>
                {onEdit && !actions ? <button type="button" aria-label={`${item.name} 수정`} disabled={disabled} onClick={() => onEdit(item)} style={linkStyle}>{item.name}</button> : item.name}
              </td>
              <td style={cellStyle}>{formatPhone(item.phone)}</td>
              {oneLine ? null : <td style={cellStyle} title={item.groupId}>{item.groupId || '—'}</td>}
              <td style={cellStyle}>
                {item.sentCount ? <button type="button" aria-label={`${item.name} 발송 이력 보기`} title={oneLine ? recipientSentSummary(item) : undefined} onClick={() => onHistory(item)} style={linkStyle}>
                  {recipientSentSummary(item, oneLine)}
                </button> : null}
              </td>
              {fields.map((name) => <td key={name} style={cellStyle}>{item.customFields?.find((field) => field.name === name)?.value || '—'}</td>)}
              {actions ? <td style={cellStyle}><div style={{ display: 'flex', gap: compact ? 6 : 12, flexWrap: 'wrap' }}>
                {onEdit ? <button type="button" aria-label={`${item.name} 수정`} disabled={disabled} onClick={() => onEdit(item)} style={{ color: colors.greenText, font: 'inherit', cursor: 'pointer' }}>수정</button> : null}
                {onRemove ? <button type="button" aria-label={`${item.name} 삭제`} disabled={disabled} onClick={() => onRemove(item)} style={{ color: colors.red, font: 'inherit', cursor: 'pointer' }}>삭제</button> : null}
              </div></td> : null}
            </tr>
          ))}
          {!items.length ? <tr><td colSpan={(oneLine ? 4 : 5) + fields.length + (actions ? 1 : 0)} style={{ ...cellStyle, padding: 24, ...(oneLine ? { height: 'auto', whiteSpace: 'normal' } : null), textAlign: 'center', color: colors.mid }}>조건에 맞는 수신자가 없습니다.</td></tr> : null}
        </tbody>
      </table>
    </div>
    </div>
  );
}

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

/** 웹에서는 실제 표 구조로 열의 의미와 키보드 조작을 제공한다. */
export function RecipientTable({ items, selectedIds, onSelectionChange, onHistory, disabled, onEdit, onRemove }: RecipientTableProps) {
  const { allInfo, compact, setAllInfo, fields } = useRecipientTableColumns(items);
  const actions = !!onRemove;
  const checkWidth = compact ? 28 : 48;
  const fixedCheck: CSSProperties = { position: 'sticky', left: 0, zIndex: 2, backgroundColor: 'inherit' };
  const fixedName: CSSProperties = { position: 'sticky', left: checkWidth, zIndex: 2, backgroundColor: 'inherit', boxShadow: '2px 0 3px rgba(0, 0, 0, 0.08)' };
  const cellStyle: CSSProperties = compact ? { ...cell, padding: '8px 4px', fontSize: text.base } : cell;
  const headingStyle: CSSProperties = compact ? { ...heading, padding: '8px 4px', fontSize: text.base } : heading;
  const visibleIds = items.map((item) => item.id);
  const selectedCount = visibleIds.filter((id) => selectedIds.includes(id)).length;
  const all = items.length > 0 && selectedCount === items.length;
  const mixed = selectedCount > 0 && !all;
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, color: colors.ink, ...fonts.body, fontSize: text.lg }}>
        <span aria-live="polite">전체 {items.length}명</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}><input type="checkbox" aria-label="모든정보" checked={allInfo} onChange={(event) => setAllInfo(event.target.checked)} style={checkbox} />모든정보</label>
      </div>
    <div style={{ width: '100%', maxHeight: 432, overflow: 'auto', border: `1px solid ${colors.borderPill}`, backgroundColor: colors.card }}>
      <table aria-label="발송 수신자 목록" style={{ width: '100%', minWidth: compact ? undefined : 600 + fields.length * 90 + (actions ? 140 : 0), borderSpacing: 0, tableLayout: 'fixed', color: colors.ink, ...fonts.body, fontSize: text.md }}>
        <thead>
          <tr>
            <th scope="col" style={{ ...headingStyle, ...fixedCheck, top: 0, zIndex: 4, backgroundColor: colors.bg, width: checkWidth, textAlign: 'center' }}>
              <input type="checkbox" aria-label="전체 선택" aria-checked={mixed ? 'mixed' : all} checked={all} ref={(node) => { if (node) node.indeterminate = mixed; }} disabled={disabled || !items.length} style={checkbox} onChange={() => onSelectionChange(all ? selectedIds.filter((id) => !visibleIds.includes(id)) : [...new Set([...selectedIds, ...visibleIds])])} />
            </th>
            <th scope="col" style={{ ...headingStyle, ...fixedName, top: 0, zIndex: 4, backgroundColor: colors.bg, width: compact ? '17%' : 95 }}>이름</th>
            <th scope="col" style={{ ...headingStyle, width: compact ? '25%' : 140 }}>전화번호</th>
            <th scope="col" style={{ ...headingStyle, width: compact ? '14%' : 95 }}>그룹</th>
            <th scope="col" style={{ ...headingStyle, width: compact || !fields.length ? undefined : 210 }}>발송건수 (최종발송일시)</th>
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
                {onEdit && !actions ? <button type="button" aria-label={`${item.name} 수정`} disabled={disabled} onClick={() => onEdit(item)} style={{ border: 0, padding: 0, background: 'transparent', color: colors.greenText, font: 'inherit', textAlign: 'left', overflowWrap: 'anywhere', textDecoration: 'underline', cursor: 'pointer' }}>{item.name}</button> : item.name}
              </td>
              <td style={cellStyle}>{formatPhone(item.phone)}</td>
              <td style={cellStyle} title={item.groupId}>{item.groupId || '—'}</td>
              <td style={cellStyle}>
                <button type="button" aria-label={`${item.name} 발송 이력 보기`} onClick={() => onHistory(item)} style={{ border: 0, padding: 0, background: 'transparent', color: colors.greenText, font: 'inherit', textAlign: 'left', overflowWrap: 'anywhere', textDecoration: 'underline', cursor: 'pointer' }}>
                  {recipientSentSummary(item)}
                </button>
              </td>
              {fields.map((name) => <td key={name} style={cellStyle}>{item.customFields?.find((field) => field.name === name)?.value || '—'}</td>)}
              {actions ? <td style={cellStyle}><div style={{ display: 'flex', gap: compact ? 6 : 12, flexWrap: 'wrap' }}>
                {onEdit ? <button type="button" aria-label={`${item.name} 수정`} disabled={disabled} onClick={() => onEdit(item)} style={{ color: colors.greenText, font: 'inherit', cursor: 'pointer' }}>수정</button> : null}
                {onRemove ? <button type="button" aria-label={`${item.name} 삭제`} disabled={disabled} onClick={() => onRemove(item)} style={{ color: colors.red, font: 'inherit', cursor: 'pointer' }}>삭제</button> : null}
              </div></td> : null}
            </tr>
          ))}
          {!items.length ? <tr><td colSpan={5 + fields.length + (actions ? 1 : 0)} style={{ ...cellStyle, padding: 24, textAlign: 'center', color: colors.mid }}>조건에 맞는 수신자가 없습니다.</td></tr> : null}
        </tbody>
      </table>
    </div>
    </div>
  );
}

export const PRIORITY_LABELS = {
  urgent: '🔴 Срочно',
  high:   '🟠 До конца дня',
  normal: '🔵 Стандарт',
  low:    '⚪ Низкий',
};

export const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };

/**
 * Compute priority for a single issue.
 *
 * @param {object}      issue            — issue object (severity, type, status)
 * @param {object|null} tripCtx          — { plannedArrival, docStatus, rawStatus }
 * @param {number}      openCountForTrip — total open (non-terminal) issues for this trip
 * @returns {{ priority: 'urgent'|'high'|'normal'|'low', reasons: string[] }}
 */
export function computePriority(issue, tripCtx, openCountForTrip) {
  const reasons = [];
  const now = new Date();

  const plannedArrival = tripCtx?.plannedArrival ? new Date(tripCtx.plannedArrival) : null;
  const hoursLeft = plannedArrival ? (plannedArrival - now) / 3_600_000 : null;
  const isToday   = plannedArrival
    ? plannedArrival.toDateString() === now.toDateString()
    : false;
  const docStatus = (tripCtx?.docStatus || '').toLowerCase();
  const rawStatus = (tripCtx?.rawStatus || '').toLowerCase();

  // ── URGENT ────────────────────────────────────────────

  if (issue.type === 'id_mismatch') {
    reasons.push('Несоответствие идентификатора требует немедленной обработки');
    return { priority: 'urgent', reasons };
  }

  if (issue.severity === 'CRIT') {
    if (hoursLeft !== null && hoursLeft >= 0 && hoursLeft < 2) {
      reasons.push(`До планового прибытия ${Math.round(hoursLeft * 60)} мин — осталось менее 2 часов`);
      return { priority: 'urgent', reasons };
    }

    if (docStatus === 'draft') {
      reasons.push('Критическое расхождение при неподписанном документе (черновик)');
      return { priority: 'urgent', reasons };
    }

    if (isToday && !['confirmed', 'dismissed', 'closed'].includes(issue.status)) {
      reasons.push('Блокирует закрытие рейса с дедлайном сегодня');
      return { priority: 'urgent', reasons };
    }
  }

  // ── LOW: already handled, awaiting formal closure ─────

  if (['confirmed', 'dismissed'].includes(issue.status)) {
    reasons.push('Расхождение обработано, ожидает формального закрытия');
    return { priority: 'low', reasons };
  }

  // ── NORMAL: completed or closed trip ──────────────────

  if (['completed', 'closed', 'done'].includes(rawStatus)) {
    reasons.push('Расхождение по завершённому рейсу');
    return { priority: 'normal', reasons };
  }

  // ── HIGH ──────────────────────────────────────────────

  if (issue.severity === 'CRIT') {
    reasons.push('Критическое расхождение — обработать до конца дня');
    if (openCountForTrip >= 3) {
      reasons.push(`По рейсу ${openCountForTrip} открытых расхождений одновременно`);
    }
    return { priority: 'high', reasons };
  }

  if (issue.severity === 'WARN') {
    if (hoursLeft !== null && hoursLeft >= 0 && hoursLeft < 6) {
      reasons.push(`До планового прибытия ${Math.round(hoursLeft * 60)} мин — менее 6 часов`);
      return { priority: 'high', reasons };
    }

    if (openCountForTrip >= 3) {
      reasons.push(`По рейсу ${openCountForTrip} открытых расхождений одновременно`);
      return { priority: 'high', reasons };
    }
  }

  // ── NORMAL: WARN default ───────────────────────────────

  reasons.push('Предупреждение, стандартный порядок обработки');
  return { priority: 'normal', reasons };
}

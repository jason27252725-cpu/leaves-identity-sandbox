function actorScope({epoch, person} = {}) {
  if (!Number.isInteger(epoch) || !person?.employeeId || !person.environment) return null;
  return JSON.stringify([epoch, person.environment, person.employeeId, person.role, person.revision,
    Object.entries(person.permissions || {}).sort(([a], [b]) => a.localeCompare(b))]);
}

export function isX1ReportQuestion(question, previous = null) {
  if (typeof question !== 'string' || !question.trim() || question.length > 200) return false;
  const text = question.normalize('NFKC').trim();
  if (/^[\/@]/u.test(text) || /SOP|報價|估價|施工|3D|SketchUp|操作|怎麼填|設定|新增|刪除|編輯|修改|匯出|歷史/i.test(text)) return false;
  const month = /(?:[1-9]|1[0-2])\s*月|上上個?月|上個?月|這個?月|本月/u.test(text);
  const metric = /待確認|實際(?:仍)?未填|未填實際|已(?:填|登錄)實際|已核定|核定|實際(?:工時|時數)/u.test(text);
  return (/(?:工時|時數)/u.test(text) && (month || metric || /20\d\d\s*年/u.test(text))) ||
    ((month || metric) && Boolean(previous || /這(?:兩|二|一|幾|些)個?案|上述|剛(?:剛|才)|(?:呢|[?？])\s*$|^(?:只|僅)/u.test(text)));
}

export function rememberReportContext(result, session) {
  const scope = actorScope(session);
  const plan = result?.reportProtocol === 1 && result.reportContext;
  const answer = typeof result?.text === 'string' ? result.text.trim() : '';
  if (!scope || !plan || typeof plan.tool !== 'string' || !answer) return null;
  return { scope, plan: structuredClone(plan), answer, anchor: answer.slice(-384) };
}

export function reportFollowupContext(messages, memory, session) {
  if (!memory || memory.scope !== actorScope(session) || messages.at(-1)?.role !== 'user' ||
      typeof messages.at(-1).content !== 'string') return null;
  const previous = messages.at(-2);
  if (previous?.role !== 'assistant' || typeof previous.content !== 'string') return null;
  const priorAnswer = previous.content.trim();
  // Core includes at most the most recent 6,000 characters from an assistant turn.
  return priorAnswer === memory.answer || (priorAnswer.length === 6000 && memory.answer.endsWith(priorAnswer))
    ? structuredClone(memory.plan) : null;
}

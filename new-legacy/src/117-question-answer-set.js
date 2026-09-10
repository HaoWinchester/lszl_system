(function (global) {
  'use strict';

  function optionIds(question) {
    return (question?.options || []).map(option => String(option?.id || '').trim()).filter(Boolean);
  }

  function normalizeIds(value, allowedIds = []) {
    const allowed = allowedIds.map(String);
    let values = Array.isArray(value) ? value : [];
    if (!Array.isArray(value) && value != null) {
      const text = String(value).trim();
      values = /[,，、;；\s]/.test(text)
        ? text.split(/[,，、;；\s]+/)
        : (text.length > 1 && allowed.every(id => id.length === 1) ? [...text] : [text]);
    }
    const selected = new Set(values.map(item => String(item).trim()).filter(id => !allowed.length || allowed.includes(id)));
    return allowed.length ? allowed.filter(id => selected.has(id)) : [...selected];
  }

  function correctIds(question) {
    const allowed = optionIds(question);
    const explicit = question?.correctOptionIds ?? question?.correct_answer_ids;
    if (explicit != null && (Array.isArray(explicit) ? explicit.length : String(explicit).trim())) {
      return normalizeIds(explicit, allowed);
    }
    const flagged = (question?.options || []).filter(option => option?.correct).map(option => option.id);
    if (flagged.length) return normalizeIds(flagged, allowed);
    return normalizeIds(question?.correctAnswer ?? question?.correct_answer ?? '', allowed);
  }

  function grade(selected, correct) {
    const left = [...new Set(normalizeIds(selected))].sort();
    const right = [...new Set(normalizeIds(correct))].sort();
    return left.length === right.length && left.every((id, index) => id === right[index]);
  }

  function contentExtension(question) {
    const result={};
    for(const key of ['images','material','caseGroup','matching']){const value=question?.[key]??question?.metadata?.[key];if(value!=null)result[key]=value;}
    if(question?.type==='matching'||question?.type==='multiple_choice'){result.type=question.type;if(question.type==='multiple_choice')result.correctOptionIds=correctIds(question);}
    return result;
  }
  function supported(question) {
    return ['single_choice', 'multiple_choice', 'matching', 'scenario', 'case_analysis'].includes(String(question?.type || 'single_choice'));
  }

  function pairs(question, value, complete = false) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const left = (question?.matching?.left || []).map(item => String(item.id));
    const right = (question?.matching?.right || []).map(item => String(item.id));
    const keys = Object.keys(value), values = keys.map(key => value[key]);
    if (!left.length || keys.some(key => !left.includes(key)) || values.some(id => typeof id !== 'string' || !right.includes(id)) || new Set(values).size !== values.length) return null;
    if (complete && (keys.length !== left.length || left.length !== right.length)) return null;
    return Object.fromEntries(left.filter(id => Object.prototype.hasOwnProperty.call(value,id)).map(id => [id,value[id]]));
  }

  function assignPair(question, current, leftId, rightId) {
    const next = {...(pairs(question, current) || {})};
    if (!(question?.matching?.left || []).some(item => item.id === leftId)) return next;
    if (!rightId) { delete next[leftId]; return next; }
    if (!(question?.matching?.right || []).some(item => item.id === rightId)) return next;
    Object.keys(next).forEach(id => { if (next[id] === rightId) delete next[id]; });
    next[leftId] = rightId;
    return pairs(question, next) || {};
  }

  function gradePairs(question, value) {
    const selected = pairs(question, value, true), correct = pairs(question, question?.matching?.correctPairs, true);
    return !!selected && !!correct && Object.keys(correct).every(id => selected[id] === correct[id]);
  }

  function answerText(question, value) {
    if (question?.type !== 'matching') return (Array.isArray(value) ? value : [value]).filter(Boolean).join('、');
    const selected = pairs(question, value) || {};
    return (question.matching?.left || []).map((item, index) => {
      const match = (question.matching?.right || []).find(right => right.id === selected[item.id]);
      return (index + 1) + ' → ' + (match?.text || '未配对');
    }).join('；');
  }

  function validate(question, options = {}) {
    if (question?.type === 'matching') {
      const errors = [], matching = question.matching || {}, left = matching.left || [], right = matching.right || [];
      if (left.length < 2 || left.length !== right.length) errors.push('匹配题至少两对，条目和候选数量须一致。');
      if ([left,right].some(rows => rows.some(item => !String(item.id||'').trim() || !String(item.text||'').trim()) || new Set(rows.map(item=>item.id)).size !== rows.length)) errors.push('条目与候选须填写内容且编号唯一。');
      if (!pairs(question, matching.correctPairs, true)) errors.push('请为每个条目设置不重复的正确配对。');
      if (options.release && !String(question.analysis || '').trim()) errors.push('发布前必须填写题目解析。');
      return errors;
    }
    if (String(question?.type || '') !== 'multiple_choice') return [];
    const ids = optionIds(question);
    const correct = correctIds(question);
    const errors = [];
    if (ids.length < 3 || ids.length > 8) errors.push('多选题须设置 3–8 个选项。');
    if (new Set(ids).size !== ids.length) errors.push('选项编号不能重复。');
    if (correct.length < 2) errors.push('多选题至少设置 2 个正确选项。');
    if (correct.length >= ids.length) errors.push('多选题至少保留 1 个错误选项。');
    if (options.release && !String(question?.analysis || '').trim()) errors.push('发布前必须填写题目解析。');
    return errors;
  }

  global.KGQuestionAnswerSet = Object.freeze({ optionIds, normalizeIds, correctIds, grade, validate, supported, pairs, assignPair, gradePairs, answerText, contentExtension });
})(typeof window !== 'undefined' ? window : globalThis);

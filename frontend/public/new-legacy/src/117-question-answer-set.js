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

  function validate(question, options = {}) {
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

  global.KGQuestionAnswerSet = Object.freeze({ optionIds, normalizeIds, correctIds, grade, validate });
})(typeof window !== 'undefined' ? window : globalThis);

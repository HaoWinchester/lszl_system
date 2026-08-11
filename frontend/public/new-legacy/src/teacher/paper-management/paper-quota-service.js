'use strict';

(function initPaperQuotaService(global) {
  const MODES = new Set(['domain', 'principle']);

  function normalizeId(value) {
    return value == null ? '' : String(value).trim();
  }

  function normalizeQuotaMap(input, fieldName) {
    if (input == null) return Object.create(null);
    if (typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError(`${fieldName} must be an object`);
    }

    const normalized = Object.create(null);
    Object.keys(input).forEach(rawKey => {
      const key = normalizeId(rawKey);
      const value = input[rawKey];
      if (!key) throw new TypeError(`${fieldName} contains an empty bucket ID`);
      if (!Number.isInteger(value) || value < 0) {
        throw new TypeError(`${fieldName}.${key} must be a non-negative integer`);
      }
      normalized[key] = value;
    });
    return normalized;
  }

  function normalizeMode(value) {
    const mode = value == null || value === '' ? 'domain' : String(value).trim();
    if (!MODES.has(mode)) throw new TypeError(`Unknown quota mode: ${mode}`);
    return mode;
  }

  function normalizeConfig(input = {}) {
    if (input == null || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('Quota config must be an object');
    }
    return {
      mode: normalizeMode(input.mode),
      domainQuotas: normalizeQuotaMap(input.domainQuotas, 'domainQuotas'),
      principleQuotas: normalizeQuotaMap(input.principleQuotas, 'principleQuotas')
    };
  }

  function compareStableIds(left, right) {
    if (left.id < right.id) return -1;
    if (left.id > right.id) return 1;
    return 0;
  }

  function normalizeCandidate(candidate) {
    if (candidate == null || typeof candidate !== 'object') return null;
    const id = normalizeId(candidate.id);
    if (!id) return null;
    const principleIds = [];
    const seenPrinciples = new Set();
    (Array.isArray(candidate.principleIds) ? candidate.principleIds : []).forEach(value => {
      const principleId = normalizeId(value);
      if (principleId && !seenPrinciples.has(principleId)) {
        seenPrinciples.add(principleId);
        principleIds.push(principleId);
      }
    });
    principleIds.sort();
    return {
      id,
      domainId: normalizeId(candidate.domainId),
      principleIds,
      eligible: candidate.eligible === true,
      archived: candidate.archived === true
    };
  }

  function stableShuffle(candidates, random) {
    const shuffled = candidates.slice().sort(compareStableIds);
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const sample = random();
      if (typeof sample !== 'number' || !Number.isFinite(sample)) {
        throw new TypeError('random must return a finite number');
      }
      const bounded = Math.max(0, Math.min(sample, 1 - Number.EPSILON));
      const swapIndex = Math.floor(bounded * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }

  function candidateMatches(candidate, mode, bucketId) {
    return mode === 'domain'
      ? candidate.domainId === bucketId
      : candidate.principleIds.includes(bucketId);
  }

  function candidatesConflict(left, right) {
    return (
      left.domainId !== right.domainId ||
      left.eligible !== right.eligible ||
      left.archived !== right.archived ||
      left.principleIds.length !== right.principleIds.length ||
      left.principleIds.some((principleId, index) => principleId !== right.principleIds[index])
    );
  }

  function selectExistingBucket(candidate, mode, bucketIds, quotas, assignments) {
    let selectedBucket = '';
    let selectedDeficit = -1;
    bucketIds.forEach(bucketId => {
      if (!candidateMatches(candidate, mode, bucketId)) return;
      const deficit = Math.max(0, quotas[bucketId] - assignments[bucketId].length);
      if (!selectedBucket || deficit > selectedDeficit) {
        selectedBucket = bucketId;
        selectedDeficit = deficit;
      }
    });
    return selectedBucket;
  }

  function uniqueIds(values) {
    const output = [];
    const seen = new Set();
    (Array.isArray(values) ? values : []).forEach(value => {
      const id = normalizeId(value);
      if (id && !seen.has(id)) {
        seen.add(id);
        output.push(id);
      }
    });
    return output;
  }

  function supplement(input = {}) {
    if (input == null || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('Supplement input must be an object');
    }
    const mode = normalizeMode(input.mode);
    const quotas = normalizeQuotaMap(input.quotas, 'quotas');
    const bucketIds = Object.keys(quotas);
    const assignments = Object.create(null);
    bucketIds.forEach(bucketId => {
      assignments[bucketId] = [];
    });

    const normalizedCandidates = (Array.isArray(input.candidates) ? input.candidates : [])
      .map(normalizeCandidate)
      .filter(Boolean);
    const candidates = [];
    const candidateById = new Map();
    normalizedCandidates.forEach(candidate => {
      const existing = candidateById.get(candidate.id);
      if (existing && candidatesConflict(existing, candidate)) {
        throw new TypeError(`Conflicting duplicate candidate ID: ${candidate.id}`);
      }
      if (!existing) {
        candidateById.set(candidate.id, candidate);
        candidates.push(candidate);
      }
    });

    const paperQuestionIds = uniqueIds(input.paperQuestionIds);
    const unassignedExistingIds = [];
    paperQuestionIds.forEach(questionId => {
      const candidate = candidateById.get(questionId);
      if (!candidate) {
        unassignedExistingIds.push(questionId);
        return;
      }
      const selectedBucket = selectExistingBucket(
        candidate,
        mode,
        bucketIds,
        quotas,
        assignments
      );
      if (!selectedBucket) {
        unassignedExistingIds.push(questionId);
        return;
      }
      assignments[selectedBucket].push(questionId);
    });

    const existingCounts = Object.create(null);
    const addedCounts = Object.create(null);
    bucketIds.forEach(bucketId => {
      existingCounts[bucketId] = assignments[bucketId].length;
      addedCounts[bucketId] = 0;
    });

    const paperIdSet = new Set(paperQuestionIds);
    const seenAvailableIds = new Set();
    const available = candidates.filter(candidate => {
      if (
        candidate.eligible !== true ||
        candidate.archived ||
        paperIdSet.has(candidate.id) ||
        seenAvailableIds.has(candidate.id)
      ) {
        return false;
      }
      seenAvailableIds.add(candidate.id);
      return true;
    });
    const random = typeof input.random === 'function' ? input.random : Math.random;
    const shuffled = stableShuffle(available, random);
    const consumedCandidateIds = new Set();
    const addedQuestionIds = [];
    const bucketCandidateIndexes = bucketIds.map(bucketId => {
      const matchingIndexes = [];
      shuffled.forEach((candidate, candidateIndex) => {
        if (candidateMatches(candidate, mode, bucketId)) matchingIndexes.push(candidateIndex);
      });
      return matchingIndexes;
    });
    const bucketQueuePositions = bucketIds.map(() => 0);

    function nextCandidateIndex(bucketIndex) {
      const queue = bucketCandidateIndexes[bucketIndex];
      let position = bucketQueuePositions[bucketIndex];
      while (
        position < queue.length &&
        consumedCandidateIds.has(shuffled[queue[position]].id)
      ) {
        position += 1;
      }
      bucketQueuePositions[bucketIndex] = position;
      return position < queue.length ? queue[position] : -1;
    }

    while (true) {
      let bestPair = null;
      bucketIds.forEach((bucketId, bucketIndex) => {
        const remainingDeficit = Math.max(
          0,
          quotas[bucketId] - assignments[bucketId].length
        );
        if (!remainingDeficit) return;
        const candidateIndex = nextCandidateIndex(bucketIndex);
        if (candidateIndex < 0) return;
        if (
          bestPair == null ||
          remainingDeficit > bestPair.remainingDeficit ||
          (remainingDeficit === bestPair.remainingDeficit &&
            (bucketIndex < bestPair.bucketIndex ||
              (bucketIndex === bestPair.bucketIndex &&
                candidateIndex < bestPair.candidateIndex)))
        ) {
          bestPair = {
            bucketId,
            bucketIndex,
            candidate: shuffled[candidateIndex],
            candidateIndex,
            remainingDeficit
          };
        }
      });
      if (!bestPair) break;
      consumedCandidateIds.add(bestPair.candidate.id);
      addedQuestionIds.push(bestPair.candidate.id);
      assignments[bestPair.bucketId].push(bestPair.candidate.id);
      addedCounts[bestPair.bucketId] += 1;
    }

    const shortages = bucketIds.flatMap(bucketId => {
      const missing = Math.max(0, quotas[bucketId] - assignments[bucketId].length);
      if (!missing) return [];
      return [{
        bucketId,
        requested: quotas[bucketId],
        existing: existingCounts[bucketId],
        added: addedCounts[bucketId],
        missing
      }];
    });

    return {
      addedQuestionIds,
      assignments,
      shortages,
      unassignedExistingIds
    };
  }

  global.KGPaperQuotaService = Object.freeze({
    normalizeConfig,
    supplement
  });
})(globalThis);

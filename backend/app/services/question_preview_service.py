"""Shared positive projection for question previews and ungraded graph practice."""
from copy import deepcopy


def practice_projection(snapshot):
    """Positive projection drops every arbitrary metadata/translation/answer carrier."""
    result = {key: deepcopy(snapshot[key]) for key in ('id', 'title', 'type', 'subject', 'difficulty', 'revision') if key in snapshot}
    result['stemParts'] = [{'text': p.get('text', '')} for p in snapshot.get('stemParts', []) if isinstance(p, dict)]
    result['options'] = [{'id': p.get('id'), 'text': p.get('text', '')} for p in snapshot.get('options', []) if isinstance(p, dict)]
    if snapshot.get('images'):
        result['images'] = deepcopy(snapshot['images'])
    if isinstance(snapshot.get('material'), dict):
        result['material'] = {key: deepcopy(snapshot['material'][key]) for key in ('id', 'revision', 'title', 'text', 'images') if key in snapshot['material']}
    if isinstance(snapshot.get('matching'), dict):
        result['matching'] = {side: [{'id': p.get('id'), 'text': p.get('text', '')} for p in snapshot['matching'].get(side, [])] for side in ('left', 'right')}
    if isinstance(snapshot.get('caseGroup'), dict):
        result['caseGroup'] = {k: deepcopy(snapshot['caseGroup'][k]) for k in ('id', 'order', 'total') if k in snapshot['caseGroup']}
    return result


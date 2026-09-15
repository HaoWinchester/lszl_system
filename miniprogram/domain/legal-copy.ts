import { showDialog } from './dialog';
import { LEGAL_DOCUMENTS } from './legal-documents.generated';
export type LegalDocumentKind = 'privacy' | 'terms';


export function legalDocument(kind: LegalDocumentKind) {
  return LEGAL_DOCUMENTS[kind];
}

export function showLegalDocument(kind: LegalDocumentKind) {
  const document = legalDocument(kind);
  return showDialog({ ...document, showCancel: false, confirmText: '知道了' });
}

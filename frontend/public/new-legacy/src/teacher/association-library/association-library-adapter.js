'use strict';
(function(global){const root=global.KGTeacherDomains=global.KGTeacherDomains||{};root.AssociationLibrary=Object.freeze({get:questionId=>global.KGRecallAssociationLibrary?.getByQuestionId?.(questionId)||null,save:record=>global.KGRecallAssociationLibrary?.save?.(record),remove:questionId=>global.KGRecallAssociationLibrary?.remove?.(questionId)})})(globalThis);

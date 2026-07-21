# Activity Schema v1

v8.6.0 introduces a canonical activity library while retaining compatibility with the existing guided-learning runner.

## Architecture boundary

- `course.nodes[*].activityIds` contains references only.
- `course.activities` is the canonical Activity Schema v1 library.
- `KGGuidedLearningData.activitiesForNode()` materializes a language-specific compatibility view for existing renderers.
- Correct answers use stable IDs and are stored separately from display text.
- Existing Chinese activities are migrated deterministically at startup; untranslated English content falls back to Chinese.

## Core record

```json
{
  "id": "env-choice-01",
  "type": "single_choice",
  "schemaVersion": 1,
  "content": {
    "zh": {
      "stem": "……",
      "options": [{"id": "A", "text": "……"}]
    },
    "en": null
  },
  "answer": {"optionId": "A"},
  "explanation": {
    "zh": {"short": "……", "detailed": "……", "incorrect": "……", "general": "……"},
    "en": null
  },
  "config": {},
  "metadata": {
    "adapter": "single_choice",
    "runtimeType": "choice",
    "source": "guided-learning-legacy",
    "translationStatus": "zh_only"
  }
}
```

## Language modes

`zh`, `en`, and `bilingual` are stored under `kg_question_language_mode_v1`.

- `zh`: Chinese content.
- `en`: English content, falling back to Chinese when missing.
- `bilingual`: aligned Chinese and English content displayed together; stable option, segment, pair, node, and relation IDs keep answers valid.

The navigation, buttons, feedback labels, and statistics remain Chinese. Only activity content is materialized by language mode.

## Public interfaces

- `KGActivitySchemaV1.fromLegacy(activity)`
- `KGActivitySchemaV1.materialize(schema, mode)`
- `KGActivitySchemaV1.validate(schema)`
- `KGActivitySchemaV1.validateLibrary(library)`
- `KGActivitySchemaV1.createPackage(library, metadata)`
- `KGActivitySchemaV1.validatePackage(package)`
- `KGGuidedLearningData.activitySchemaById(id)`
- `KGGuidedLearningData.getActivityLibrary()`
- `KGGuidedLearningData.exportActivityPackage(metadata)`

## Migration status

Standard activities have dedicated adapters:

- single choice
- keyword recognition
- matching
- open response
- memory matching

Deep recall, multi-question induction, knowledge graph, and challenge activities are wrapped by a compatibility adapter in v8.6.0. They keep working unchanged and can later receive dedicated schema editors without changing activity IDs or node references.

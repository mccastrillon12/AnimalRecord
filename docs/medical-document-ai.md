# Medical document AI

> Before changing this module, read
> [`medical-document-strategy.md`](./medical-document-strategy.md). That file is
> the functional source of truth. This document describes the current technical
> implementation, including known differences from the target strategy.

Frontend implementers and coding agents should also read
[`frontend-medical-document-integration.md`](./frontend-medical-document-integration.md)
for the complete HTTP sequence, polling rules, review payloads, and UI cases.
For localized field rendering, the implementation guide is
[`frontend-medical-document-field-catalog.md`](./frontend-medical-document-field-catalog.md).
For user-selected filing categories that differ from extracted content, use
[`frontend-medical-document-category-override.md`](./frontend-medical-document-category-override.md).

## Runtime flow

The animal-transfer rules confirmed on 2026-10-25 are documented in
[`medical-document-strategy.md`](./medical-document-strategy.md) and
[`animal-transfer-strategy.md`](./animal-transfer-strategy.md). They require a
complete read-only history for the former owner and independent copies under
the new owner's existing S3 hierarchy. Transfer-aware permissions, historical
retention are not implemented in
the active medical runtime yet; the flow described below still uses the current
single-owner document model with the preliminary processing lock described next.

The transfer implementation now centralizes current-owner and writable checks
in `AnimalAccessPolicy`; `MedicalDocumentAnimalAccess` reuses that policy while
keeping its existing entry point. Medical writes return conflict while an animal
has a processing transfer lock. This is not historical read support and does
not yet create archives, copy files, or change the BDA/review contract. See
[`final-delivery-plan.md`](./final-delivery-plan.md) for completed and pending work.

HTTP mutations now hold persistent per-animal write claims throughout their
application/S3 work, including rejection cleanup, ANALYZING polling, replacement
and legacy normalization. Polling re-fetches the document under the claims;
completed reads and already-normalized groups remain pure reads. Legacy DELETE
claims all animals sharing the record, not only the route's animal. PDF rescue
waits for every page upload to settle even if one fails, before returning the
same clinical fallback. No AI rule, extraction schema, category or 48-hour window
changes. ANALYZING GET and REJECT can now return transfer-related HTTP 409; see
[`animal-write-coordination.md`](./animal-write-coordination.md) and the frontend guide.

The eighth transfer sub-block adds a majority-acknowledged technical journal
before new coordinated HTTP callbacks, including analysis, polling, review,
replacement, deletion and legacy normalization. Backend callers assign operation
kinds; no extraction/request payload is retained. Journal preparation can fail
with the existing generic 500 or a journal-specific 409 before the callback runs;
later evidence failures preserve the original success/error. HTTP bodies, BDA
routing, categories, versions and the 48-hour rule remain unchanged. Local journal
completion does not mean an asynchronous AWS analysis finished. Pure reads and
anonymous global feedback do not create journals. Contracts and integration are
centralized in [frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md);
technical states/limitations are in [animal-write-journal.md](./animal-write-journal.md).

`OwnershipArchiveModule` now provides an internal preparation pipeline for
immutable record snapshots and verified S3 copies. It accepts independent
accepted medical records, preserves their codes/extractions/first acceptance
dates, and rejects unnormalized multi-animal records. It does not change the
medical HTTP/BDA flow, publish history, activate recipient references or adapt
deletion/replacement retention yet. An internal `OwnershipArchiveCapture` now
checks pending/unknown medical states under a drained reservation and validates
accepted legacy records before starting a paginated initial-period capture.
It does not cancel analysis or normalize documents; a denied preflight releases
only its own newly acquired reservation so the owner can resolve the work.
After archive creation is attempted, failures preserve the lock for safe retry.
This does not change medical HTTP/BDA behavior, schemas, codes or the 48-hour window.
Later ownership periods are refused until retained history is imported. Full
S3-cut handling and business decision integration are still pending. See
[`ownership-archive-capture.md`](./ownership-archive-capture.md) and
[`ownership-archive-preparation.md`](./ownership-archive-preparation.md).

Transfer sub-block 12 adds an explicit internal predecessor-history importer
for manual archive preparations, preserving document snapshots and historical
file revisions/digests even when an active document was replaced/deleted.
It does not change this medical runtime, AI, codes, first acceptance or 48-hour
window, and does not yet implement active deletion/replacement retention or
historical HTTP access. Automatic capture retains its initial-period guard;
later-period activation/commit integration is pending. Tests use synthetic
archive chains and Mongo/S3 doubles, not real transfers. See
[ownership-archive-history.md](./ownership-archive-history.md) and the central
[frontend contract](./frontend-animal-transfer-foundations.md).

1. `POST /medical-documents/analyze` receives a `multipart/form-data` file,
   `animalIds`, an optional `requestedCategory`, and an optional user-authored
   `description` of at most 500 characters. The description is stored and
   returned but is never sent to BDA or used for classification.
2. The API validates animal ownership and stores one private source file under
   `users/{ownerId}/medical-document-intake/{documentId}/`. For JPEG and PNG it
   also creates `analysis-input.pdf`, while the original image remains the
   source of truth.
3. JPEG and PNG start with the original raster against the project's single
   `IMAGE` router blueprint. A detected `DIAGNOSTIC_IMAGE` completes directly.
   Every other result, no-match, or failed IMAGE attempt starts a second BDA
   invocation with `analysis-input.pdf` against the `DOCUMENT` blueprints.
   PDF and TIFF start directly in the document flow. A substantive
   `CLINICAL_HISTORY` completes without a second pass. An unclassified PDF, or
   a clinical-history match containing only metadata and no clinical context,
   enters a visual rescue stage: at most three representative pages are
   rendered as temporary JPEG files. A hollow clinical-history match stops
   after its first non-diagnostic IMAGE result; a confirmed diagnostic image
   continues through the remaining samples. Invocation ARNs, rescue progress
   and output URIs are persisted, and the API returns HTTP `202` with status
   `ANALYZING`.
4. The frontend polls `GET /medical-documents/:documentId`. That endpoint checks
   `GetDataAutomationStatus`; when AWS finishes, it reads every custom and
   standard `result.json` under the job output prefix in S3.
5. Every logical subdocument is normalized and merged by category. Before the
   domain accepts the result, the application reconciles a provider primary
   category that was omitted from `detectedCategories`: it restores the missing
   detection when a matching extraction exists, otherwise it uses the strongest
   valid detection. This provider inconsistency must not surface as an HTTP 400
   during polling. The document changes to `REVIEW_PENDING` only after all
   readable segments are consolidated. AWS zero-based page indexes are exposed
   through the API as one-based page numbers, while preserving inclusive page
   ranges for frontend review.
6. `PUT /medical-documents/:documentId/review` accepts `finalCategory`, the
   user-validated extraction, and per-animal assignments, or rejects with a
   required stable rejection reason. `finalCategory` controls filing while
   `validatedExtraction.documentType` controls the extraction shape; they may
   differ.
7. Acceptance creates one independent accepted MongoDB record per animal. Each
   record receives its own id, business code (when supported), single final S3
   location, assignment, version and 48-hour window. Records originating from
   the same analysis share `documentGroupId`. Only after all records and copies
   are persisted does the backend remove the intake source and BDA output.
   Rejection removes the same temporary artifacts.
8. Accepted diagnoses are added to the assigned animals. Other clinical
   sections remain associated with the document until their own history models
   exist.
9. `GET /animals/:animalId/medical-documents` reads accepted structured data
   from MongoDB. The optional `category` query filters by the user-selected
   final category; clients render `validatedExtraction` without downloading the
   source file.
10. After an accepted process, the frontend can send an anonymous `LIKE` or
    `DISLIKE`. The backend atomically increments one global total and does not
    associate the response with a user or document.

Accepted documents support an independent 48-hour replacement workflow per
animal, anchored to that record's first `acceptedAt`. Before starting, the
frontend reads `GET /medical-documents/{id}/related-documents`, which returns
the accepted records sharing `documentGroupId`, and selects a nonempty subset
of animals. `POST /medical-documents/{id}/replacement-analysis` sends those
`animalIds`, the new file and optional `description`; it creates a separate
non-accepted candidate and reuses the normal asynchronous BDA flow. All
accepted records remain the source of truth while the candidate is analyzed.
`PUT /medical-documents/{id}/replacement-review` either rejects the candidate
and deletes its temporary S3 artifacts or atomically replaces only the selected
records using their individual versions. On acceptance, `finalCategory` is
required and may differ from both the old category and
`validatedExtraction.documentType`. It controls each selected record's new S3
category folder, query classification, and business code. An unchanged category
preserves the existing code; a changed category generates one new
category-specific code per selected animal, or clears the code for categories
without a consecutive. Unselected animals keep their prior category, code,
file, extraction, description, version and deadline. Replacement preserves the
selected records' `acceptedAt` values and 48-hour deadlines.

`DELETE /animals/{animalId}/medical-documents/{documentId}` removes that
animal's independent accepted MongoDB record and its single final S3 object.
Other records in the same `documentGroupId` are not touched.

The application limit remains 10 MB. Supported MIME types are PDF, JPEG, PNG,
and TIFF. JPEG and PNG use a two-stage multimodal route: original raster first
for safe visual classification and a single-page PDF only as the document
fallback. Suspect PDFs use the inverse rescue route: DOCUMENT first and
temporary rendered JPEG pages through IMAGE second. Neither route is selected
by `requestedCategory`. TIFF is sent directly. The BDA project must have
document splitting enabled for mixed or long PDFs; splitting is a project
setting and is not enabled by the runtime request.

## Environment

The Lightsail container needs these values in addition to the existing S3 configuration:

```dotenv
AWS_BDA_REGION=us-east-1
AWS_BDA_PROFILE_ARN=arn:aws:bedrock:us-east-1:590184143435:data-automation-profile/us.data-automation-v1
AWS_BDA_PROJECT_ARN=arn:aws:bedrock:us-east-1:590184143435:data-automation-project/55d040f23bb1
```

AWS credentials can continue to come from `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. The new adapters also support the AWS SDK default credential chain when those variables are omitted.

Acceptance of a replacement for one or more animals uses a MongoDB transaction
that updates every selected document and closes the candidate together. The
deployment referenced by `MONGO_URI` must therefore support transactions
(MongoDB Atlas, a replica set, or a sharded cluster). A standalone local
MongoDB is sufficient for unit tests and normal document analysis, but it
cannot execute the final multi-document replacement transaction.

The runtime identity needs access to the configured BDA project/profile and
`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, and `s3:ListBucket`
permission for the prefixes below:

```text
users/{ownerId}/medical-document-intake/{documentId}/
users/{ownerId}/animals/{animalId}/medical-documents/{categorySlug}/{documentId}/
```

There is one analysis record in MongoDB while a document is pending or under
review. It can hold an extraction per detected category. Acceptance separates
that analysis into one accepted record per animal; each keeps the validated
extraction under its own `documentType`, while the separately selected
`finalCategory` controls filing, storage and category queries. The records share
`documentGroupId` only for related-document discovery. Historical accepted
records that still contain multiple animals are separated lazily before the
replacement UI is returned.

For category screens, use one of these requests:

```text
GET /animals/{animalId}/medical-documents
GET /animals/{animalId}/medical-documents?category=VACCINATION_CARD
```

The unfiltered request returns every accepted category. The filtered request
uses the compound MongoDB index on `animalIds`, `finalCategory`, `status`, and
`createdAt`. In both cases, `validatedExtraction` is the approved clinical data
contract for display; downloading the original file is optional.

The internal `analysisInvocationArn` and `analysisOutputUri` fields support
polling and crash recovery but are never exposed by the HTTP API. A missing ARN
is recovered by starting again with the same idempotency token.

The domain stores `temporaryStorageKey` during analysis. Every accepted record
has one animal and one entry in `documentLocations`. A failed final copy removes
the copies completed by that request. A version conflict protects locations
already committed by a concurrent acceptance. Rejected documents remove the
intake object and create no final copies. The raster analysis key is
deterministic (`analysis-input.pdf`), so interrupted jobs can resume with the
same BDA input without adding a second persisted identity. Acceptance,
rejection and failed starts delete both the auxiliary PDF and BDA output.
Rendered PDF rescue pages live below `analysis-output/pdf-rescue/`, so the same
prefix cleanup removes their inputs and BDA results without touching the source
PDF.

Supported accepted categories receive a business code in addition to their
UUID. `PRESCRIPTION`, `MEDICAL_ORDER`, `REFERRAL`, `CLINICAL_HISTORY`,
`DIAGNOSTIC_IMAGE`, and `LABORATORY_RESULT` use the prefixes `F`, `O`, `R`,
`H`, `I`, and `L`. The current country component is the fixed value `57`;
counters are global across users and independent by category. The shared
MongoDB `counters` collection increments the sequence atomically.
`VACCINATION_CARD`, `OTHER`, rejected documents, and historical accepted
records are valid without a code. The response exposes `documentCode`,
`documentSequence`, and `documentCountryCode`; clients add the visual `N°`
label themselves.

For compatibility, records created before this flow can still use the legacy
`storageKey`. New downloads use the first final location because every animal
copy contains the same original file.

## Blueprint contract

Configure the BDA project with regular blueprints for prescriptions, medical
orders, referrals, vaccination cards, clinical histories, diagnostic images,
and laboratory results. No custom fallback blueprint is required: unmatched
documents use BDA standard output and the backend maps them to `OTHER`. The JSON
schemas used to create the custom blueprints are versioned in
`docs/aws/blueprints`.

Every blueprint should produce the same top-level field names. Fields that do not apply can be empty arrays or omitted when optional.

The clinical-history blueprint keeps only the essential fields for vaccination
entries embedded in a history (`name`, `diseases_covered`, `lot`,
`application_date`, and `next_dose_date`). This keeps the schema within BDA's
30 list-leaf-field limit. A standalone or split vaccination section is handled
by the dedicated vaccination-card blueprint, which retains the complete
vaccination contract.

A standalone laboratory, imaging, cytology, or pathology report is not a
clinical history. Diagnostic images use the dedicated `DIAGNOSTIC_IMAGE`
category. Standalone laboratory reports, including hematology, blood chemistry,
parasitology, microbiology, immunology, serology, cytology, and molecular tests,
use `LABORATORY_RESULT`. Other unsupported diagnostic reports remain `OTHER`.
The clinical-history schema excludes all of these reports even when they contain
a patient, owner, referring veterinarian, record number, or the literal label
"Historia Clinica".

AI output is transcriptional, not an autonomous clinical opinion. Blueprint
instructions must not ask the model to compare results with reference ranges or
infer that a value is high, low, normal, abnormal, elevated, or decreased. The
mapper does not populate `diagnosticResults[].interpretation` from AI output. A
standalone diagnostic report falsely matched by BDA is downgraded to `OTHER`,
and its category-specific clinical fields are removed. Authored professional
comments can only be transcribed and validated through the human review
workflow.

The common extraction contract uses `reportedSummary`,
`reportedRecommendations`, and `reportedObservations` only for text visibly
authored in the source document. The canonical blueprint keys are
`reported_summary`, `reported_recommendations`, and `reported_observations`.
They are explicit fields and must remain empty when the source has no matching
section. `reportedRecommendations` also covers author-written indications,
instructions, directions, advice, home care, and discharge instructions under
Spanish or English headings. The mapper accepts legacy Spanish/English aliases
for that content but always exposes the single canonical API property
`reportedRecommendations`. It preserves the original language and never
translates, summarizes, infers, or generates the text. The mapper never fills
these fields from BDA standard-output summaries and does not expose an
AI-authored narrative as document content. The legacy
`summary` property remains readable for historical records but is no longer
populated by new analyses or included in the localized presentation catalog.

For `PRESCRIPTION`, `medications[].instructions` and
`reportedRecommendations` have different scopes. Medication instructions only
contain text attributable to that medication in its row or block. A separately
headed general recommendations, indications, or instructions section belongs
to `reportedRecommendations`, even when individual medications also have their
own instructions. The mapper does not promote medication instructions into the
general field because doing so would change their meaning.

The diagnostic-image blueprint is intentionally transcription-only. It may
extract visible labels, technical metadata, and professional-authored report
text into `diagnostic_image`. `reported_technique`, `reported_findings`,
`reported_conclusion`, and `reported_diagnosis` only contain sections already
written in the source report; none may be generated by inspecting pixels. They
map to the corresponding camel-case fields in `diagnosticImages[]`.
`reportedDiagnosis` is never copied to the generic `diagnoses` collection, so
acceptance cannot apply it automatically to the animal. Authored summary,
recommendation and observation sections remain transcription-only common
fields. BDA returns one
`diagnostic_image` object per analyzed segment;
the mapper normalizes and merges those objects into the API array
`diagnosticImages`.

Its class description explicitly recognizes an independent radiograph or image
series whose principal content is the visual study, even when the only text is
a technical overlay such as `Patient ID`, `DX`, `RX`, `X-ray`, `Series`,
`Image`, a region or a projection. This reinforcement does not inspect pixels
or use `requestedCategory`; photographs of other documents still compete
against every configured document blueprint.

The project also requires one `IMAGE` blueprint authored from
`diagnostic-image-raster.schema.json`. AWS allows only one image blueprint per
project, so it acts as a safe raster router. It returns `DIAGNOSTIC_IMAGE` only
when the pixels are the diagnostic study itself; photographs or captures of
forms and reports return `DOCUMENT_SCAN`, while unrelated content returns
`OTHER`. Only the first value completes the IMAGE stage. All other values are
reanalyzed through the PDF copy and the regular document blueprints. The image
schema contains no reported diagnosis or clinical interpretation fields.

The PDF rescue is deliberately fail-open. If rendering or an IMAGE invocation
fails, the application retains the original DOCUMENT analysis and adds a review
warning instead of failing the upload. A clinical-history extraction with a
substantive consultation, anamnesis, examination, diagnosis, evolution,
treatment or follow-up bypasses rescue completely. A hollow clinical-history
match probes its first page and stops immediately if the page is not diagnostic.
An unclassified PDF may use all three samples. Once a diagnostic page is found,
the remaining representative pages are examined and the diagnostic result uses
their original PDF page numbers. Long PDFs sample only the first, middle and
last pages and warn that only representative pages were examined.

### Deferred lower-latency route

If production timings remain above the product target, the approved next
experiment is a structure-only PDF preflight followed by IMAGE-first routing.
This is not part of the current runtime. The preflight may inspect page count,
selectable-text density and full-page raster coverage, but it must not classify
medical content or inspect pixels for clinical meaning. A candidate uses the
IMAGE blueprint first and falls back to the existing DOCUMENT route for
`DOCUMENT_SCAN`, `OTHER`, no-match or failure.

Before enabling it, add PHI-free stage timings for DOCUMENT analysis, S3
download, rendering, polling gaps and IMAGE analysis. Up to three representative
IMAGE jobs may then run concurrently if BDA quotas allow it, or the process may
finish after the first diagnostic confirmation when reduced metadata coverage
is acceptable. A persistent worker may advance jobs independently of frontend
polling. All variants retain the original file, fail open to DOCUMENT, ignore
`requestedCategory` for routing and preserve the no-clinical-interpretation
rule.

The laboratory-result blueprint is also transcription-only. It extracts report
and specimen metadata into `laboratory_report` and creates one
`laboratory_results` row for each written analyte, examination, agent, control,
or structured observation. Numeric and qualitative results are strings so the
original separators, signs, units, and wording remain unchanged. `flag` is only
accepted when a marker such as `*`, `H`, `L`, `+`, or `-` is printed; the model
must never derive it by comparing a result with its reference interval.
`reported_comments` may contain only comments, interpretations,
or conclusions already authored in the report. The mapper exposes these as
`laboratoryReport.reportedComments`, never as generic animal diagnoses. Any
generated summary is discarded.

```json
{
  "document_type": "PRESCRIPTION | MEDICAL_ORDER | REFERRAL | VACCINATION_CARD | CLINICAL_HISTORY | DIAGNOSTIC_IMAGE | LABORATORY_RESULT | OTHER",
  "document_sections": [
    {
      "category": "PRESCRIPTION",
      "page_start": 1,
      "page_end": 2,
      "evidence": "string"
    }
  ],
  "reported_summary": "string",
  "reported_recommendations": "string",
  "reported_observations": "string",
  "document_date": "string",
  "issuer": {
    "name": "string",
    "clinic": "string",
    "professional_id": "string"
  },
  "owner": {
    "name": "string",
    "identification": "string",
    "phone": "string",
    "email": "string",
    "address": "string"
  },
  "patient": {
    "name": "string",
    "identifier": "string",
    "species": "string",
    "breed": "string",
    "sex": "string",
    "color": "string",
    "size": "string",
    "reproductive_status": "string",
    "age": "string",
    "birth_date": "string",
    "weight": "string",
    "microchip": "string"
  },
  "patient_hints": ["string"],
  "diagnoses": [],
  "medications": [],
  "vaccinations": [],
  "medical_orders": [],
  "clinical_history": {},
  "diagnostic_results": [],
  "diagnostic_image": {
    "name": "string",
    "modality": "string",
    "study_date": "string",
    "study_time": "string",
    "study_description": "string",
    "body_region": "string",
    "projection": "string",
    "laterality": "string",
    "marker": "string",
    "series_number": "string",
    "image_number": "string",
    "accession_number": "string",
    "calibration_status": "string",
    "reported_technique": "string",
    "reported_findings": "string",
    "reported_conclusion": "string",
    "reported_diagnosis": "string"
  },
  "laboratory_report": {
    "report_number": "string",
    "order_number": "string",
    "specimen_type": "string",
    "specimen_status": "string",
    "collection_date": "string",
    "received_date": "string",
    "report_date": "string",
    "analysis_date": "string",
    "methods": ["string"],
    "equipment": ["string"],
    "analysts": ["string"],
    "reviewers": ["string"],
    "reported_comments": ["string"]
  },
  "laboratory_results": [
    {
      "name": "string",
      "panel": "string",
      "result": "string",
      "unit": "string",
      "reference_range": "string",
      "flag": "string",
      "method": "string",
      "technical_details": "string"
    }
  ],
  "referral": {},
  "warnings": []
}
```

The mapper also recognizes the Spanish aliases used in current samples, but the
English snake-case contract above is canonical. `document_sections` exists in
all seven versioned schemas and represents coherent document sections, not an
isolated mention of another category. `owner` and `patient` contain only values
explicitly present in the source document; absent properties are omitted.
`patient_hints` remains a compatibility fallback for fragments that cannot be
mapped safely and its array order has no semantic meaning.

The repository version of `clinical-history.schema.json` includes the standalone
diagnostic-report exclusion and non-interpretation rules. It requires a new LIVE
version after the currently attached `animal-record-clinical-history_v2` before
the AWS-side guard is active; the backend mapper guard is independent of that
publication.

## Localized field catalog

`GET /medical-documents/field-catalog?category={CATEGORY}&locale=es-CO`
returns the current Spanish presentation contract for one extraction category.
It is authenticated like the other medical-document endpoints and responds
with `Cache-Control: private, max-age=3600`.

The response contains `catalogVersion`, the normalized locale, a category
label, ordered sections, ordered field definitions, table columns, editing and
empty-value hints, and the technical keys that clients must preserve without
rendering as ordinary fields. `es` and `es-CO` currently resolve to `es-CO`.

The service does not transform extraction payloads. AWS, MongoDB, review
requests, and response DTOs continue using canonical English keys. Medical
values remain opaque source text and are never translated or interpreted by
the catalog. Dynamic `additionalFields` use the Spanish generic label supplied
by the catalog while retaining their original keys internally.

## Review request

For acceptance, send the version returned by the analysis, the single final
category selected by the user, its fully validated extraction, and one
assignment for every associated animal:

```json
{
  "decision": "ACCEPT",
  "documentVersion": 1,
  "finalCategory": "REFERRAL",
  "validatedExtraction": {
    "documentType": "REFERRAL"
  },
  "assignments": [
    {
      "animalId": "UUID",
      "extractedItemIds": ["diagnosis-1", "medication-1"]
    }
  ]
}
```

`validatedExtraction.documentType` may differ from `finalCategory`. The domain
validates category-specific sections against the extraction's own
`documentType`, while storage paths, business codes and category queries use
`finalCategory`. Changing only the filing category does not rerun AI or
transform the extraction.

For rejection, `decision`, `documentVersion`, and `rejectionReason` are
required. Valid reason codes are `INCORRECT_INFORMATION`, `WRONG_ANIMAL`, and
`OTHER`; `OTHER` additionally requires a non-empty `rejectionComment` of at
most 500 characters. `GET /medical-documents/rejection-reasons` returns the
codes, Spanish labels, and `requiresComment` metadata for the dropdown.
Rejection deletes the S3 object while preserving the rejected database record,
reason, and comment for audit.

## Global process feedback

`POST /medical-documents/ai-feedback` accepts `{ "value": "LIKE" }` or
`{ "value": "DISLIKE" }`. It updates the single
`medical_document_feedback_totals` record with an atomic MongoDB increment.
`GET /medical-documents/ai-feedback/summary` returns likes, dislikes, total, and
the global approval percentage.

This initial metric intentionally has no user, document, animal, category, or
blueprint association and has no change or withdrawal operation. Consequently,
the backend cannot enforce one response per upload or deduplicate a repeated
HTTP request. The frontend disables both controls only after a successful POST
and shows fresh controls after the next accepted process.

## AWS project

The LIVE project `animal-record-medical-documents` was configured in
`us-east-1` on 2026-08-07 and its attached versions were most recently verified
in the console on 2026-08-30. It has document splitting enabled, no fallback
blueprint, and these seven LIVE versions attached:

- `animal-record-prescription_v2`
- `animal-record-medical-order_v2`
- `animal-record-referral_v2`
- `animal-record-vaccination-card_v2`
- `animal-record-clinical-history_v2`
- `animal-record-diagnostic-image_v1`
- `animal-record-laboratory-result_v1`

The multimodal raster fix additionally requires one associated IMAGE blueprint,
expected as `animal-record-diagnostic-image-raster_v1`, created from
`diagnostic-image-raster.schema.json`. It is separate from the DOCUMENT
diagnostic-image blueprint and does not replace any of the seven document
blueprints.

The repository schemas remain the source used for future immutable versions.
The authored-content change requires publishing a new immutable LIVE version
of every DOCUMENT blueprint and replacing the previously associated version in
the project. All seven must move together because the common contract adds
`reported_summary`, `reported_recommendations`, and `reported_observations` and
removes generated `summary` fields. The IMAGE router schema also removes its
generated summary and therefore needs a new LIVE version, but it intentionally
does not extract authored recommendations or observations from pixels. Do not
delete the older versions until project-level regression tests pass.

Use the next available version number for each blueprint rather than assuming a
fixed suffix. Apply the rollout in this order:

1. Deploy the backend first. It understands the new authored-content fields and
   already discards AI-generated summaries while the previous blueprints remain
   associated.
2. Publish and associate the new LIVE versions of all seven DOCUMENT
   blueprints, then the updated IMAGE router blueprint.
3. Run project-level regression tests for every category and for an unmatched
   document. Keep the previous immutable versions available for rollback until
   these tests pass.
4. Release or refresh the frontend against field catalog `1.1.0`; it must render
   the three `reported*` fields and must not render legacy `summary`.

Do not publish the blueprints before the compatible backend is deployed: an
older backend would treat the new keys as dynamic additional fields instead of
the canonical authored-content contract.

Unmatched documents receive standard output and are mapped to `OTHER` by the
application. The frontend must poll while the status is `ANALYZING` and only
show review controls for `REVIEW_PENDING`.

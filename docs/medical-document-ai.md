# Medical document AI

> Before changing this module, read
> [`medical-document-strategy.md`](./medical-document-strategy.md). That file is
> the functional source of truth. This document describes the current technical
> implementation, including known differences from the target strategy.

Frontend implementers and coding agents should also read
[`frontend-medical-document-integration.md`](./frontend-medical-document-integration.md)
for the complete HTTP sequence, polling rules, review payloads, and UI cases.

## Runtime flow

1. `POST /medical-documents/analyze` receives a `multipart/form-data` file,
   `animalIds`, and an optional `requestedCategory`.
2. The API validates animal ownership and stores one private source file under
   `users/{ownerId}/medical-document-intake/{documentId}/`.
3. The API starts `InvokeDataAutomationAsync` with the document ID as its
   idempotency token, persists the invocation ARN, and returns HTTP `202` with
   status `ANALYZING`.
4. The frontend polls `GET /medical-documents/:documentId`. That endpoint checks
   `GetDataAutomationStatus`; when AWS finishes, it reads every custom and
   standard `result.json` under the job output prefix in S3.
5. Every logical subdocument is normalized and merged by category. The document
   changes to `REVIEW_PENDING` only after all readable segments are consolidated.
   AWS zero-based page indexes are exposed through the API as one-based page
   numbers, while preserving inclusive page ranges for frontend review.
6. `PUT /medical-documents/:documentId/review` accepts `finalCategory`, the
   category-specific corrections, and per-animal assignments, or rejects with
   a required stable rejection reason.
7. Acceptance copies the source into every animal's final category folder,
   assigns the global business code when the category supports one, persists
   all final locations, and then removes the intake source and BDA output
   objects. Rejection removes the same temporary artifacts.
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

The application limit remains 10 MB. Supported MIME types are PDF, JPEG, PNG,
and TIFF. The BDA project must have document splitting enabled for mixed or long
PDFs; splitting is a project setting and is not enabled by the runtime request.

## Environment

The Lightsail container needs these values in addition to the existing S3 configuration:

```dotenv
AWS_BDA_REGION=us-east-1
AWS_BDA_PROFILE_ARN=arn:aws:bedrock:us-east-1:590184143435:data-automation-profile/us.data-automation-v1
AWS_BDA_PROJECT_ARN=arn:aws:bedrock:us-east-1:590184143435:data-automation-project/55d040f23bb1
```

AWS credentials can continue to come from `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. The new adapters also support the AWS SDK default credential chain when those variables are omitted.

The runtime identity needs access to the configured BDA project/profile and
`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, and `s3:ListBucket`
permission for the prefixes below:

```text
users/{ownerId}/medical-document-intake/{documentId}/
users/{ownerId}/animals/{animalId}/medical-documents/{categorySlug}/{documentId}/
```

There is one logical medical document in MongoDB. During review it can hold an
extraction per detected category. Acceptance retains only the selected category
payload and the validated extraction. Records created by the previous
single-extraction implementation are upgraded in memory when read.

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

The domain stores `temporaryStorageKey` during analysis and one entry in
`documentLocations` per animal after acceptance. A failed final copy removes
the copies completed by that request. A version conflict protects locations
already committed by a concurrent acceptance. Rejected documents remove the
intake object and create no final copies.

Supported accepted categories receive a business code in addition to their
UUID. `PRESCRIPTION`, `MEDICAL_ORDER`, `REFERRAL`, and `CLINICAL_HISTORY` use
the prefixes `F`, `O`, `R`, and `H`. The current country component is the fixed
value `57`; counters are global across users and independent by category. The
shared MongoDB `counters` collection increments the sequence atomically.
`VACCINATION_CARD`, `OTHER`, rejected documents, and historical accepted
records are valid without a code. The response exposes `documentCode`,
`documentSequence`, and `documentCountryCode`; clients add the visual `N°`
label themselves.

For compatibility, records created before this flow can still use the legacy
`storageKey`. New downloads use the first final location because every animal
copy contains the same original file.

## Blueprint contract

Configure the BDA project with regular blueprints for prescriptions, medical
orders, referrals, vaccination cards, and clinical histories. No custom
fallback blueprint is required: unmatched documents use BDA standard output
and the backend maps them to `OTHER`. The JSON schemas used to create the
custom blueprints are versioned in `docs/aws/blueprints`.

Every blueprint should produce the same top-level field names. Fields that do not apply can be empty arrays or omitted when optional.

The clinical-history blueprint keeps only the essential fields for vaccination
entries embedded in a history (`name`, `diseases_covered`, `lot`,
`application_date`, and `next_dose_date`). This keeps the schema within BDA's
30 list-leaf-field limit. A standalone or split vaccination section is handled
by the dedicated vaccination-card blueprint, which retains the complete
vaccination contract.

A standalone laboratory, imaging, cytology, or pathology report is not a
clinical history. Until the domain defines a dedicated diagnostic-report
category, the backend maps it to `OTHER`. The clinical-history schema excludes
these reports even when they contain a patient, owner, referring veterinarian,
record number, or the literal label "Historia Clinica".

AI output is transcriptional, not an autonomous clinical opinion. Blueprint
instructions must not ask the model to compare results with reference ranges or
infer that a value is high, low, normal, abnormal, elevated, or decreased. The
mapper does not populate `diagnosticResults[].interpretation` from AI output. A
standalone diagnostic report falsely matched by BDA is downgraded to `OTHER`,
its category-specific clinical fields are removed, and its summary is replaced
with a neutral description. Authored professional comments can only be
transcribed and validated through the human review workflow.

```json
{
  "document_type": "PRESCRIPTION | MEDICAL_ORDER | REFERRAL | VACCINATION_CARD | CLINICAL_HISTORY | OTHER",
  "document_sections": [
    {
      "category": "PRESCRIPTION",
      "page_start": 1,
      "page_end": 2,
      "summary": "string",
      "evidence": "string"
    }
  ],
  "summary": "string",
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
  "referral": {},
  "warnings": []
}
```

The mapper also recognizes the Spanish aliases used in current samples, but the
English snake-case contract above is canonical. `document_sections` exists in
all five versioned schemas and represents coherent document sections, not an
isolated mention of another category. `owner` and `patient` contain only values
explicitly present in the source document; absent properties are omitted.
`patient_hints` remains a compatibility fallback for fragments that cannot be
mapped safely and its array order has no semantic meaning.

The repository version of `clinical-history.schema.json` includes the standalone
diagnostic-report exclusion and non-interpretation rules. It requires a new LIVE
version after the currently attached `animal-record-clinical-history_v2` before
the AWS-side guard is active; the backend mapper guard is independent of that
publication.

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

`validatedExtraction.documentType` must equal `finalCategory`, and category
specific sections from other categories are rejected by the domain.

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
`us-east-1` on 2026-08-07 and its attached versions were verified on
2026-08-08. It has document splitting enabled, no fallback blueprint, and these
five LIVE versions attached:

- `animal-record-prescription_v2`
- `animal-record-medical-order_v2`
- `animal-record-referral_v2`
- `animal-record-vaccination-card_v2`
- `animal-record-clinical-history_v2`

Unmatched documents receive standard output and are mapped to `OTHER` by the
application. The frontend must poll while the status is `ANALYZING` and only
show review controls for `REVIEW_PENDING`.

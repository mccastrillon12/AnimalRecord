# Medical document AI

## Runtime flow

1. `POST /medical-documents/analyze` receives a `multipart/form-data` file and `animalIds`.
2. The API validates animal ownership and stores the private source file in S3.
3. Amazon Bedrock Data Automation analyzes the S3 object synchronously.
4. The original extraction is stored with status `REVIEW_PENDING` and returned to the client.
5. `PUT /medical-documents/:documentId/review` accepts corrections and per-animal assignments.
6. Accepted diagnoses are added to the assigned animals. Other clinical sections remain associated with the document until their own history models exist.

The application limit is 10 MB. Supported MIME types are PDF, JPEG, PNG, and TIFF. The synchronous BDA API also limits documents to 10 pages.

## Environment

The Lightsail container needs these values in addition to the existing S3 configuration:

```dotenv
AWS_BDA_REGION=us-east-1
AWS_BDA_PROFILE_ARN=arn:aws:bedrock:us-east-1:ACCOUNT_ID:data-automation-profile/PROFILE_ID
AWS_BDA_PROJECT_ARN=arn:aws:bedrock:us-east-1:ACCOUNT_ID:data-automation-project/PROJECT_ID
```

AWS credentials can continue to come from `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. The new adapters also support the AWS SDK default credential chain when those variables are omitted.

The runtime identity needs access to the configured BDA project/profile and permission to read, write, and delete objects below:

```text
users/{ownerId}/medical-documents/{documentId}/
```

## Blueprint contract

Configure the BDA project with regular blueprints for prescriptions, medical orders, referrals, and vaccination cards. Configure the generic document blueprint as the project fallback for `OTHER` documents.

Every blueprint should produce the same top-level field names. Fields that do not apply can be empty arrays or omitted when optional.

```json
{
  "document_type": "PRESCRIPTION | MEDICAL_ORDER | REFERRAL | VACCINATION_CARD | OTHER",
  "summary": "string",
  "document_date": "string",
  "issuer": {
    "name": "string",
    "clinic": "string",
    "professional_id": "string"
  },
  "patient_hints": ["string"],
  "diagnoses": [],
  "medications": [],
  "vaccinations": [],
  "medical_orders": [],
  "referral": {},
  "warnings": []
}
```

The mapper also recognizes the Spanish aliases used in current samples, but the English snake-case contract above is canonical.

## Review request

For acceptance, send the version returned by the analysis, the fully validated extraction, and one assignment for every associated animal:

```json
{
  "decision": "ACCEPT",
  "documentVersion": 1,
  "validatedExtraction": {},
  "assignments": [
    {
      "animalId": "UUID",
      "extractedItemIds": ["diagnosis-1", "medication-1"]
    }
  ]
}
```

For rejection, only `decision` and `documentVersion` are required. Rejection deletes the S3 object while preserving the rejected database record for audit.

## Lightsail

The frontend can remain in a loading state while analysis runs, but the reverse proxy and container request timeout must exceed the measured BDA latency. If production documents approach that timeout, the existing document ID and status model can be extended to return `202 PROCESSING` without changing the review contract.

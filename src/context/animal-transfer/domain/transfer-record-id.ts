import { v5 as uuidv5 } from 'uuid';
export const transferRecordId = (
  kind: string,
  transferId: string,
  scope = '',
) =>
  uuidv5(
    `https://animalrecord.app/transfers/${kind}/${transferId}/${scope}`,
    uuidv5.URL,
  );

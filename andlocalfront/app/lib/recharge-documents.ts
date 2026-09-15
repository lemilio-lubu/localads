import type { AccountType } from "../design-system/types";

export type RechargeDocumentKind = "invoice" | "transfer";

export type RechargeDocument = {
  id: string;
  accountType: AccountType;
  kind: RechargeDocumentKind;
  file: Blob;
  name: string;
  type: string;
  savedAt: string;
};

const databaseName = "andlocal-documents";
const storeName = "recharge-documents";
const databaseVersion = 1;

function documentId(accountType: AccountType, kind: RechargeDocumentKind) {
  return `${accountType}:${kind}`;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, databaseVersion);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveRechargeDocument(accountType: AccountType, kind: RechargeDocumentKind, file: File) {
  const database = await openDatabase();
  const document: RechargeDocument = {
    id: documentId(accountType, kind),
    accountType,
    kind,
    file,
    name: file.name,
    type: file.type,
    savedAt: new Date().toISOString(),
  };

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(document);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

  database.close();
}

export async function getRechargeDocument(accountType: AccountType, kind: RechargeDocumentKind) {
  const database = await openDatabase();

  const document = await new Promise<RechargeDocument | undefined>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(documentId(accountType, kind));
    request.onsuccess = () => resolve(request.result as RechargeDocument | undefined);
    request.onerror = () => reject(request.error);
  });

  database.close();
  return document;
}

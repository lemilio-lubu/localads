import { Module } from "@nestjs/common";
import { RECEIPT_OBJECT_STORAGE } from "./receipt-object-storage";
import { R2ReceiptObjectStorage } from "./r2-receipt-object-storage";
import { LocalReceiptObjectStorage } from "./local-receipt-object-storage";

@Module({
  providers: [{
    provide: RECEIPT_OBJECT_STORAGE,
    useFactory: () => process.env.NODE_ENV === "production" || process.env.R2_BUCKET
      ? new R2ReceiptObjectStorage()
      : new LocalReceiptObjectStorage(),
  }],
  exports: [RECEIPT_OBJECT_STORAGE],
})
export class StorageModule {}

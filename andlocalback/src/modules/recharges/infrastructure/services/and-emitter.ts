/* Datos fiscales de AND como emisor, tal como figuran en el RIDE que genera
   Migo (factura 001-001-000000664). Son fijos a propósito: deben coincidir
   con los de Migo y el SRI, así que no se editan desde la plataforma. Si AND
   cambia de dirección o de régimen, se cambian aquí y en Migo a la vez. */

export type InvoiceEmitter = Readonly<{
  legalName: string;
  tradeName: string;
  ruc: string;
  headOffice: string;
  branch: string;
  keepsAccounting: boolean;
  taxpayerType: string;
}>;

export const AND_EMITTER: InvoiceEmitter = {
  legalName: "ANDMD SAS",
  tradeName: "AND MARKETING DIGITAL",
  ruc: "1793224091001",
  headOffice: "Ecuador, Quito.",
  branch: "Ecuador, Quito.",
  keepsAccounting: true,
  taxpayerType: "Sociedad",
};

/* El proveedor que firma y envía las facturas al SRI; el RIDE de Migo lo
   nombra en la información adicional y el nuestro también. */
export const MIGO_PROVIDER = { name: "MIGO SISTEMA CONTABLE", ruc: "1891759106001" } as const;

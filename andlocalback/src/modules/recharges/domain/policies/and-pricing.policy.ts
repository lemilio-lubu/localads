import { MonetaryAmount } from "../value-objects/monetary-amount";

export type AndPricingBreakdown = Readonly<{
  pautaAmount: MonetaryAmount;
  isdAmount: MonetaryAmount;
  agencyCommissionAmount: MonetaryAmount;
  vatBaseAmount: MonetaryAmount;
  vatAmount: MonetaryAmount;
  totalAmount: MonetaryAmount;
  isdRateBasisPoints: 500;
  agencyCommissionRateBasisPoints: 1000;
  vatRateBasisPoints: 1500;
}>;

export class AndPricingPolicy {
  static readonly ISD_RATE_BASIS_POINTS = 500 as const;
  static readonly AGENCY_COMMISSION_RATE_BASIS_POINTS = 1000 as const;
  static readonly VAT_RATE_BASIS_POINTS = 1500 as const;

  calculate(pautaAmount: MonetaryAmount): AndPricingBreakdown {
    const isdAmount = pautaAmount.multiplyRatio(AndPricingPolicy.ISD_RATE_BASIS_POINTS, 10_000);
    const agencyCommissionAmount = pautaAmount.multiplyRatio(
      AndPricingPolicy.AGENCY_COMMISSION_RATE_BASIS_POINTS,
      10_000,
    );
    const vatBaseAmount = pautaAmount.add(isdAmount).add(agencyCommissionAmount);
    const vatAmount = vatBaseAmount.multiplyRatio(AndPricingPolicy.VAT_RATE_BASIS_POINTS, 10_000);

    return Object.freeze({
      pautaAmount,
      isdAmount,
      agencyCommissionAmount,
      vatBaseAmount,
      vatAmount,
      totalAmount: vatBaseAmount.add(vatAmount),
      isdRateBasisPoints: AndPricingPolicy.ISD_RATE_BASIS_POINTS,
      agencyCommissionRateBasisPoints: AndPricingPolicy.AGENCY_COMMISSION_RATE_BASIS_POINTS,
      vatRateBasisPoints: AndPricingPolicy.VAT_RATE_BASIS_POINTS,
    });
  }
}

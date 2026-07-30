import { proxyManager } from './proxyManager.js';

export class SwitchereService {
  constructor() {
    this.baseUrl = 'https://api.switchere.com';
  }

  async getCryptoRates() {
    try {
      const res = await proxyManager.fetchWithProxy(`${this.baseUrl}/v1/public/rates`, {
        headers: { 'User-Agent': 'MemeCoinBot/1.0' }
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      // Fallback a calcolo estimativo di mercato
    }
    return null;
  }

  async estimatePurchase(fiatAmount = 5, fiatCurrency = 'EUR', cryptoSymbol = 'SOL') {
    const amount = Number(fiatAmount);
    if (isNaN(amount) || amount < 5) {
      throw new Error('L\'importo minimo per l\'acquisto su Switchere è di 5 EUR.');
    }

    let solPriceEur = 180; // Prezzo stimato di mercato
    try {
      const priceRes = await proxyManager.fetchWithProxy('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=eur,usd');
      if (priceRes.ok) {
        const data = await priceRes.json();
        if (data?.solana?.[fiatCurrency.toLowerCase()]) {
          solPriceEur = data.solana[fiatCurrency.toLowerCase()];
        }
      }
    } catch (err) {
      // Fallback
    }

    // Struttura Fee Trasparente Switchere (Processing Fee: 3.9%, Card/Gateway Fee: ~1.1%, Net Network Fee: ~0.0005 SOL)
    const processingFeePercent = 3.9;
    const cardFeePercent = 1.1;
    const totalFeePercent = processingFeePercent + cardFeePercent;

    const totalFeesFiat = Number((amount * (totalFeePercent / 100)).toFixed(2));
    const netFiatAmount = Math.max(0, amount - totalFeesFiat);
    const estimatedCrypto = Number((netFiatAmount / solPriceEur).toFixed(4));

    return {
      fiatAmount: amount,
      fiatCurrency: fiatCurrency.toUpperCase(),
      cryptoSymbol: cryptoSymbol.toUpperCase(),
      solPriceFiat: solPriceEur,
      estimatedCrypto,
      breakdown: {
        grossAmount: `${amount} ${fiatCurrency.toUpperCase()}`,
        processingFee: `${(amount * (processingFeePercent / 100)).toFixed(2)} ${fiatCurrency.toUpperCase()} (${processingFeePercent}%)`,
        cardGatewayFee: `${(amount * (cardFeePercent / 100)).toFixed(2)} ${fiatCurrency.toUpperCase()} (${cardFeePercent}%)`,
        totalPlatformFees: `${totalFeesFiat} ${fiatCurrency.toUpperCase()} (${totalFeePercent}%)`,
        netAmountInvested: `${netFiatAmount.toFixed(2)} ${fiatCurrency.toUpperCase()}`,
        estimatedOutput: `~${estimatedCrypto} ${cryptoSymbol.toUpperCase()}`
      }
    };
  }

  generatePurchaseUrl(walletAddress, fiatAmount = 5, fiatCurrency = 'EUR', cryptoSymbol = 'SOL') {
    const amountVal = Math.max(5, Number(fiatAmount) || 5);
    const params = new URLSearchParams({
      fiat: fiatCurrency.toUpperCase(),
      crypto: cryptoSymbol.toUpperCase(),
      amount: amountVal.toString(),
      destination: walletAddress || ''
    });
    return `https://switchere.com/?${params.toString()}`;
  }
}

export const switchereService = new SwitchereService();

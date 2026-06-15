// api/scanner.js
// Vercel Serverless Function – Yahoo Finance 실시간 데이터 + Monster Score
// 배포 후 https://너의도메인.vercel.app/api/scanner 로 호출

export const config = {
  runtime: 'nodejs',
  maxDuration: 30, // 최대 30초 허용
};

// 스캔할 티커 목록 (저유통주 + 급등주 후보)
const TICKERS = [
  'GME','AMC','MARA','RIOT','MULN','FFIE','TOP','HKD','NVOS','CYN',
  'HOLO','BPTS','MGOL','SINT','GNS','ATER','BRSH','CETX','LGMK','TTOO',
  'NKLA','LCID','RIVN','PLTR','SOFI','HOOD','RKLB','ASTS','IONQ','QBTS',
  'SERV','SMCI','MSTR','COIN','CLSK','WULF','BTBT','CAN','HIVE','DNN',
  'UUUU','UEC','SMR','OKLO','NNE','BWXT','LEU','CXAI','SOUN','BBAI',
  'QSI','CRKN','CGBS','ADTX','WISA','XELA','PEGY','CEAD','VTAK','BJDX',
  'APLD','GRRR','ONDS','KULR','RCAT','PDYN','OPTT','PLUG','FCEL','BLDP',
  'QS','MVST','SES','SLDP','AMPX','EOSE','FLNC','STEM','SPWR','RUN',
  'MAXN','NOVA','SEDG','ENPH','FSLR','ARRY','SHLS','CSIQ','JKS','DQ',
  'DRUG','HOTH','TNXP','MIRA','AVGR','BBLG','CERO','GLMD','PALI','SONN',
  'VRM','VWE','WETG','ZURA','TPST','SCLX','BCAN','SMFL','NIR','LIFW',
  'CNXA','GBNH','PTPI','KALA','REVB','YTEN','GGE','BIAF','VRAR','ISUN'
];

// Yahoo Finance v8 차트 데이터 조회
async function fetchYahooChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d&includePrePost=true`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Monster Score 계산
function calcScore(meta, vwap, vwapStr, orb5, orb15, orb30) {
  const price = meta.regularMarketPrice || 0;
  const volume = meta.regularMarketVolume || 0;
  const float = meta.floatShares || meta.sharesOutstanding || 50000000;
  const avgVol = meta.averageDailyVolume3Month || volume || 1;
  const prevClose = meta.chartPreviousClose || price;
  const open = meta.regularMarketOpen || prevClose;
  const short = meta.shortPercentOfFloat || 0;

  const fr = float > 0 ? volume / float : 0;
  const rvol = avgVol > 0 ? volume / avgVol : 0;
  const gap = prevClose > 0 ? Math.abs((open - prevClose) / prevClose * 100) : 0;
  const distVwap = vwap > 0 ? ((price - vwap) / vwap * 100) : 0;

  let frScore = fr >= 20 ? 35 : fr >= 10 ? 25 : fr >= 5 ? 15 : fr >= 3 ? 10 : fr >= 1 ? 5 : 0;
  let rvScore = rvol >= 20 ? 20 : rvol >= 10 ? 15 : rvol >= 5 ? 10 : rvol >= 2 ? 5 : 0;
  let vwScore = vwapStr >= 90 ? 15 : vwapStr >= 70 ? 10 : vwapStr >= 50 ? 5 : 0;
  let orbScore = orb30 ? 10 : orb15 ? 7 : orb5 ? 5 : 0;
  let gapScore = gap >= 50 ? 10 : gap >= 20 ? 7 : gap >= 10 ? 5 : gap >= 5 ? 3 : 0;
  let siScore = short >= 35 ? 10 : short >= 25 ? 7 : short >= 15 ? 5 : 0;

  let total = frScore + rvScore + vwScore + orbScore + gapScore + siScore;

  // 페널티
  if (price < vwap) total -= 15;
  const dayHigh = meta.regularMarketDayHigh || price;
  const distHod = dayHigh > 0 ? ((price - dayHigh) / dayHigh * 100) : 0;
  if (distHod < -20) total -= 20;
  else if (distHod < -15) total -= 10;
  else if (distHod < -10) total -= 5;

  total = Math.max(0, Math.min(100, Math.round(total)));

  const grade = total >= 95 ? 'SSS' : total >= 90 ? 'SS' : total >= 85 ? 'S' : total >= 75 ? 'A' : total >= 65 ? 'B' : 'C';
  const buy = total >= 85 && rvol >= 5 && fr >= 3 && price > vwap && (orb5 || orb15 || orb30);

  return {
    total, grade, buy,
    rvol: +rvol.toFixed(2),
    floatRotation: +fr.toFixed(2),
    gap: +gap.toFixed(1),
    distVwap: +distVwap.toFixed(1),
    scoreBreakdown: { frScore, rvScore, vwScore, orbScore, gapScore, siScore }
  };
}

// 단일 종목 분석
async function analyzeOne(symbol) {
  try {
    const json = await fetchYahooChart(symbol);
    const result = json?.chart?.result?.[0];
    if (!result?.meta?.regularMarketPrice) return null;

    const meta = result.meta;
    const quotes = result.indicators?.quote?.[0] || {};
    const timestamps = result.timestamp || [];
    const closes = quotes.close || [];
    const highs = quotes.high || [];
    const lows = quotes.low || [];
    const vols = quotes.volume || [];

    // VWAP
    let tpv = 0, tv = 0, aboveVwap = 0, validBars = 0;
    for (let i = 0; i < closes.length; i++) {
      if (closes[i] != null && vols[i] != null && vols[i] > 0) {
        const tp = (highs[i] + lows[i] + closes[i]) / 3;
        tpv += tp * vols[i];
        tv += vols[i];
      }
    }
    const vwap = tv > 0 ? tpv / tv : meta.regularMarketPrice;
    for (let i = 0; i < closes.length; i++) {
      if (closes[i] != null) {
        validBars++;
        if (closes[i] > vwap) aboveVwap++;
      }
    }
    const vwapStr = validBars > 0 ? (aboveVwap / validBars) * 100 : 50;

    // ORB
    const open = meta.regularMarketOpen || meta.chartPreviousClose || meta.regularMarketPrice;
    const price = meta.regularMarketPrice;
    let orb5 = false, orb15 = false, orb30 = false;
    if (timestamps.length && open > 0) {
      let openIdx = 0;
      for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] != null && Math.abs(closes[i] - open) < open * 0.03) { openIdx = i; break; }
      }
      const rangeHigh = (start, mins) => {
        const end = timestamps[start] + mins * 60;
        let h = 0;
        for (let i = start; i < timestamps.length && timestamps[i] <= end; i++) {
          if (highs[i] && highs[i] > h) h = highs[i];
        }
        return h;
      };
      orb5 = price > rangeHigh(openIdx, 5);
      orb15 = price > rangeHigh(openIdx, 15);
      orb30 = price > rangeHigh(openIdx, 30);
    }

    const score = calcScore(meta, vwap, vwapStr, orb5, orb15, orb30);

    return {
      symbol,
      companyName: meta.longName || symbol,
      price: +price.toFixed(2),
      changePercent: +(meta.regularMarketChangePercent || 0).toFixed(2),
      volume: meta.regularMarketVolume || 0,
      avgVolume30: meta.averageDailyVolume3Month || 0,
      floatShares: meta.floatShares || meta.sharesOutstanding || 0,
      shortInterest: meta.shortPercentOfFloat || 0,
      vwap: +vwap.toFixed(4),
      vwapStrength: +vwapStr.toFixed(1),
      orb5, orb15, orb30,
      premarketPrice: meta.preMarketPrice || null,
      premarketChange: meta.preMarketChangePercent || null,
      dayHigh: meta.regularMarketDayHigh || price,
      dayLow: meta.regularMarketDayLow || price,
      open,
      prevClose: meta.chartPreviousClose || price,
      week52High: meta.fiftyTwoWeekHigh || price,
      ...score,
    };
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    // 5개씩 병렬 처리 (야후 제한 우회)
    const results = [];
    for (let i = 0; i < TICKERS.length; i += 5) {
      const batch = TICKERS.slice(i, i + 5);
      const batchResults = await Promise.all(batch.map(s => analyzeOne(s)));
      results.push(...batchResults.filter(Boolean));
      // 300ms 지연
      if (i + 5 < TICKERS.length) await new Promise(r => setTimeout(r, 300));
    }

    // Monster Score 기준 정렬
    results.sort((a, b) => b.total - a.total);

    res.status(200).json({
      success: true,
      count: results.length,
      stocks: results.slice(0, 50), // 상위 50개만
      timestamp: Date.now(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
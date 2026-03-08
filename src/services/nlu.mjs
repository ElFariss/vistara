import { generateJsonWithGemini } from './gemini.mjs';
import { listTemplateIds } from './queryTemplates.mjs';
import { normalizeWhitespace, toLowerAlnum } from '../utils/text.mjs';

const INTENTS = [
  'show_metric',
  'compare',
  'rank',
  'explain',
  'filter',
  'smalltalk',
  'dataset_inspection',
  'modify_dashboard',
  'set_goal',
  'generate_report',
  'data_management',
];

function extractTimePeriod(text) {
  const lower = text.toLowerCase();
  const known = ['hari ini', 'kemarin', 'minggu ini', 'minggu lalu', 'bulan ini', 'bulan lalu', '30 hari', '3 bulan'];
  return known.find((item) => lower.includes(item)) || '7 hari terakhir';
}

function extractBranch(text) {
  const match = text.match(/cabang\s+([a-zA-Z0-9\s]+)/i);
  if (!match) {
    return null;
  }
  return normalizeWhitespace(match[1]).replace(/\b(saja|aja|dong|ya)\b/gi, '').trim() || null;
}

function extractMetric(text) {
  const lower = toLowerAlnum(text);
  if (lower.includes('penjualan') || lower.includes('sales')) {
    return 'omzet';
  }
  if (lower.includes('untung') || lower.includes('profit') || lower.includes('laba')) {
    return 'untung';
  }
  if (lower.includes('margin')) {
    return 'margin';
  }
  if (lower.includes('biaya') || lower.includes('pengeluaran')) {
    return 'biaya';
  }
  if (lower.includes('produk') || lower.includes('terlaris')) {
    return 'produk';
  }
  if (lower.includes('cabang')) {
    return 'cabang';
  }
  return 'omzet';
}

function extractVisualization(text) {
  const lower = toLowerAlnum(text);
  if (/\b(line|garis|trend|tren|grafik)\b/i.test(lower)) {
    return 'line';
  }
  if (/\b(bar|batang)\b/i.test(lower)) {
    return 'bar';
  }
  if (/\b(pie|donut|lingkaran)\b/i.test(lower)) {
    return 'pie';
  }
  if (/\b(table|tabel)\b/i.test(lower)) {
    return 'table';
  }
  if (/\b(metric|kartu|single)\b/i.test(lower)) {
    return 'metric';
  }
  return null;
}

function looksAnalyticsMessage(text) {
  const lower = toLowerAlnum(text);
  return /(omzet|penjualan|revenue|untung|profit|laba|margin|biaya|pengeluaran|produk|cabang|grafik|chart|dashboard|canvas|tren|trend|laporan|report|target|goal|kpi|performa|analisis|top|terlaris|rank|ranking|compare|banding|vs|minggu|bulan|hari)/i.test(lower);
}

function looksSmalltalkMessage(text) {
  const lower = toLowerAlnum(text);
  if (/^(hi|halo|hello|hai|pagi|siang|sore|malam|permisi|test|tes)\b/i.test(lower)) {
    return true;
  }
  if (/\b(thanks|thank you|makasih|terima kasih|mantap|sip)\b/i.test(lower)) {
    return true;
  }
  if (/\b(siapa nama saya|nama saya siapa|siapa saya|who am i|apa nama saya|namaku siapa)\b/i.test(lower)) {
    return true;
  }
  if (/\b(apa kabar|gimana kabar|selamat pagi|selamat siang|selamat sore|selamat malam)\b/i.test(lower)) {
    return true;
  }
  return false;
}

function looksDatasetInspectionMessage(text) {
  const lower = toLowerAlnum(text);
  const schemaTerms = /\b(kolom|column|columns|schema|field|fields|struktur data|profil data|profil dataset|eda|korelasi|correlation)\b/i;
  const qualityTerms = /\b(quality data|kualitas data|missing|null|kosong|duplikat|duplicate)\b/i;
  const inspectionCommand = /\b(cek|check|periksa|inspect|review|lihat)\b.*\b(dataset|kolom|schema|field|struktur|profil|kualitas)\b/i;
  return schemaTerms.test(lower) || qualityTerms.test(lower) || inspectionCommand.test(lower);
}

function fallbackIntent(message) {
  const lower = toLowerAlnum(message);
  const isSmalltalk = looksSmalltalkMessage(message);
  const isDatasetInspection = looksDatasetInspectionMessage(message);
  const isAnalytics = looksAnalyticsMessage(message);
  let intent = isSmalltalk || !isAnalytics ? 'smalltalk' : 'show_metric';

  if (isDatasetInspection) {
    intent = 'dataset_inspection';
  }

  if (intent !== 'smalltalk' && intent !== 'dataset_inspection' && /(banding|vs|dibanding|compare)/i.test(lower)) {
    intent = 'compare';
  } else if (intent !== 'smalltalk' && intent !== 'dataset_inspection' && /(top|terlaris|paling|rank|ranking)/i.test(lower)) {
    intent = 'rank';
  } else if (intent !== 'smalltalk' && intent !== 'dataset_inspection' && /(kenapa|mengapa|penyebab|explain)/i.test(lower)) {
    intent = 'explain';
  } else if (intent !== 'smalltalk' && intent !== 'dataset_inspection' && /(tambah|tambahkan|hilangkan|hapus|ganti|fokus|simpan dashboard|template)/i.test(lower)) {
    intent = 'modify_dashboard';
  } else if (intent !== 'smalltalk' && intent !== 'dataset_inspection' && /(target|goal)/i.test(lower)) {
    intent = 'set_goal';
  } else if (intent !== 'smalltalk' && intent !== 'dataset_inspection' && /(laporan|report)/i.test(lower)) {
    intent = 'generate_report';
  } else if (intent !== 'smalltalk' && intent !== 'dataset_inspection' && /(upload|gabung|hapus data|update hpp|mapping)/i.test(lower)) {
    intent = 'data_management';
  }

  const dashboardAction =
    intent === 'modify_dashboard'
      ? /hilang|hapus/i.test(lower)
        ? 'remove_component'
        : /fokus/i.test(lower)
          ? 'focus_metric'
          : /simpan/i.test(lower)
            ? 'save_dashboard'
            : /ganti/i.test(lower)
              ? 'change_granularity'
              : 'add_component'
      : null;

  return {
    intent,
    metric: intent === 'show_metric' || intent === 'compare' || intent === 'rank' || intent === 'explain'
      ? extractMetric(message)
      : null,
    visualization: intent === 'show_metric' || intent === 'compare' || intent === 'rank' || intent === 'explain'
      ? extractVisualization(message)
      : null,
    time_period: intent === 'show_metric' || intent === 'compare' || intent === 'rank' || intent === 'explain'
      ? extractTimePeriod(message)
      : null,
    branch: extractBranch(message),
    channel: /tokopedia/i.test(lower)
      ? 'tokopedia'
      : /shopee/i.test(lower)
        ? 'shopee'
        : /offline/i.test(lower)
          ? 'offline'
          : null,
    template_id: null,
    limit: intent === 'smalltalk' ? null : /top\s*10/i.test(lower) ? 10 : 5,
    dashboard_action: dashboardAction,
  };
}

function sanitizeIntent(raw, fallback) {
  if (!raw || typeof raw !== 'object') {
    return fallback;
  }

  const intent = INTENTS.includes(raw.intent) ? raw.intent : fallback.intent;
  const templateIds = listTemplateIds();
  const templateId = templateIds.includes(raw.template_id) ? raw.template_id : null;

  return {
    intent,
    metric: typeof raw.metric === 'string' ? raw.metric : fallback.metric,
    visualization: typeof raw.visualization === 'string'
      ? (['metric', 'line', 'bar', 'pie', 'table'].includes(raw.visualization.toLowerCase()) ? raw.visualization.toLowerCase() : fallback.visualization)
      : fallback.visualization,
    time_period: typeof raw.time_period === 'string' ? raw.time_period : fallback.time_period,
    branch: typeof raw.branch === 'string' ? raw.branch : fallback.branch,
    channel: typeof raw.channel === 'string' ? raw.channel : fallback.channel,
    template_id: templateId,
    limit: Number.isFinite(Number(raw.limit)) ? Math.max(1, Math.min(50, Number(raw.limit))) : fallback.limit,
    dashboard_action: typeof raw.dashboard_action === 'string' ? raw.dashboard_action : fallback.dashboard_action,
    dashboard_component: typeof raw.dashboard_component === 'string' ? raw.dashboard_component : null,
    dashboard_name: typeof raw.dashboard_name === 'string' ? raw.dashboard_name : null,
    target_value: Number.isFinite(Number(raw.target_value)) ? Number(raw.target_value) : null,
  };
}

export async function parseIntent(message, history = []) {
  const fallback = fallbackIntent(message);
  const hasExplicitSmalltalk = looksSmalltalkMessage(message);
  const hasDatasetInspectionSignal = looksDatasetInspectionMessage(message);
  const hasAnalyticsSignal = looksAnalyticsMessage(message);

  // Fast-path untuk sapaan/smalltalk agar tidak salah klasifikasi oleh model.
  // Ini juga menghemat kuota karena tidak perlu memanggil LLM.
  if (hasExplicitSmalltalk && !hasAnalyticsSignal) {
    return {
      ...fallback,
      intent: 'smalltalk',
      metric: null,
      visualization: null,
      time_period: null,
      limit: null,
      nlu_source: 'rule_smalltalk',
    };
  }

  if (hasDatasetInspectionSignal) {
    return {
      ...fallback,
      intent: 'dataset_inspection',
      metric: null,
      visualization: null,
      time_period: null,
      limit: null,
      nlu_source: 'rule_dataset_inspection',
    };
  }

  const result = await generateJsonWithGemini({
    systemPrompt: [
      'Kamu adalah NLU engine Vistara untuk analitik bisnis berbahasa Indonesia.',
      'Kembalikan JSON valid tanpa markdown.',
      `intent harus salah satu: ${INTENTS.join(', ')}`,
      `template_id harus null atau salah satu: ${listTemplateIds().join(', ')}`,
    ].join(' '),
    userPrompt: JSON.stringify({
      message,
      history: history.slice(-5),
      expected_fields: {
        intent: 'string',
        metric: 'string|null',
        visualization: 'string|null',
        time_period: 'string|null',
        branch: 'string|null',
        channel: 'string|null',
        template_id: 'string|null',
        limit: 'number|null',
        dashboard_action: 'string|null',
        dashboard_component: 'string|null',
        dashboard_name: 'string|null',
        target_value: 'number|null',
      },
    }),
    temperature: 0,
    maxOutputTokens: 300,
  });

  if (!result.ok || !result.data) {
    return {
      ...fallback,
      nlu_source: 'fallback',
    };
  }

  return {
    ...sanitizeIntent(result.data, fallback),
    nlu_source: 'gemini',
  };
}

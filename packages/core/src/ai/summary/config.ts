/** Daily AI summary output contract: limits, deny-list and the no-data text live here (R5). */

export const SUMMARY_TOPICS = ['price', 'signals', 'news', 'financials', 'portfolio'] as const;
export type SummaryTopic = (typeof SUMMARY_TOPICS)[number];

export interface AiSummaryConfig {
  bodyVersion: 1;
  maxSentenceChars: number;
  maxSentencesPerSection: number;
  maxIdsPerSentence: number;
  maxSections: number;
  /** Matches the SQL guard on ai_summaries.body (32 KB). */
  maxBodyBytes: number;
  /** Matches the SQL guard on ai_summaries.input_ids. */
  maxInputIds: number;
  noDataText: string;
  /** Regex sources, matched with flag `u` on NFC-lowercased text: price targets, return promises, certainty, buy/sell advice. */
  denyPatterns: readonly string[];
}

export const AI_SUMMARY_CONFIG: AiSummaryConfig = {
  bodyVersion: 1,
  maxSentenceChars: 280,
  maxSentencesPerSection: 4,
  maxIdsPerSentence: 6,
  maxSections: 5,
  maxBodyBytes: 32_768,
  maxInputIds: 200,
  noDataText: 'Không có dữ liệu.',
  denyPatterns: [
    'giá mục tiêu',
    'mục tiêu giá',
    'target price',
    'kỳ vọng (tăng|giảm|sinh lời|lợi nhuận)',
    'cam kết',
    'đảm bảo (lợi nhuận|sinh lời|lãi)',
    'chắc chắn (tăng|giảm|lãi)',
    'lãi chắc',
    'nên (mua|bán)',
    'khuyến nghị (mua|bán)',
    'sẽ (tăng|giảm) (lên|xuống|đến|tới)',
  ],
};

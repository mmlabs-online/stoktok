/**
 * Seeded Vietnamese exchange holiday calendar (R5: configuration, not logic).
 *
 * One calendar for HOSE, HNX and UPCoM: all three close on the same days, set by one SGDVN letter per year.
 * Weekdays only: make-up Saturdays (2025-04-26, 2026-01-10, 2026-08-22) are never trading days and the weekend
 * logic already covers them. Ad-hoc closures (storms, system failures) are not holidays.
 *
 * Sources are secondary (news outlets and legal aggregators quoting the exchange notices).
 * Dates to be verified against the original notices on hsx.vn / hnx.vn before go-live.
 * `provisional: true` means the exchanges have not published the date yet; the app uses it like any other.
 */
export interface SeededHoliday {
  /** Weekday, 'YYYY-MM-DD' (Vietnam date). */
  date: string;
  name: string;
  source: string;
  provisional: boolean;
}

const S2025 =
  'HOSE 2079/TB-SGDHCM (26/12/2024), SGDVN 1046/SGDVN-GSTT (25/12/2024) and later notices; https://nhandan.vn/ocop/hnx-nghi-giao-dich-3-ngay-dip-le-chien-thang-304-va-ngay-quoc-te-lao-dong-15-post874441.html';
const S2025_TET = 'HOSE 2079/TB-SGDHCM, SGDVN 1046/SGDVN-GSTT; https://thitruongtaichinhtiente.vn/lich-nghi-giao-dich-chung-khoan-dip-tet-nguyen-dan-at-ty-2025-65365.html';
const S2025_NEWYEAR = 'HOSE 2079/TB-SGDHCM, SGDVN 1046/SGDVN-GSTT; https://nhandan.vn/ocop/chung-khoan-nghi-giao-dich-1-ngay-dip-tet-duong-lich-nam-2025-post852361.html';
const S2025_NATIONAL = 'HOSE 2079/TB-SGDHCM, SGDVN 1046/SGDVN-GSTT; https://nhandan.vn/ocop/chung-khoan-nghi-giao-dich-2-ngay-dip-quoc-khanh-29-post903022.html';
const S2026_TET = 'HNX 5305/TB-SGDHN, SGDVN 1403/SGDVN-THHC; https://nhandan.vn/ocop/chung-khoan-nghi-giao-dich-5-ngay-dip-tet-am-lich-nam-2026-post943421.html';
const S2026_NEWYEAR = 'SGDVN 1403/SGDVN-THHC, HNX 2026 calendar notice; https://thitruongtaichinhtiente.vn/lich-nghi-giao-dich-chung-khoan-tet-duong-lich-2026-75790.html';
const S2026_HUNG = 'HOSE 2294/TB-SGDHCM and later notices; https://thuvienphapluat.vn/hoi-dap-phap-luat/san-hose-khi-nao-nghi-gio-to-hung-vuong-2026-138084516.html';
const S2026_LABOUR = 'HOSE 2294/TB-SGDHCM and later notices; https://thuvienphapluat.vn/hoi-dap-phap-luat/san-hose-nghi-le-30-4-1-5-nam-2026-tu-ngay-nao-138085279.html';
const S2026_NATIONAL = 'SGDVN 1403/SGDVN-THHC, HOSE notice (no trading on 22/8); https://doanhnhan.baophapluat.vn/hose-thong-bao-lich-nghi-le-quoc-khanh-2-9-khong-giao-dich-bu-vao-thu-bay-22-08.html';
const S2026_CULTURE =
  'Resolution 28/2026/QH16, VPCP letter 10065/VPCP-KGVX; no exchange notice yet; https://baovanhoa.vn/van-hoa/ngay-van-hoa-viet-nam-nam-2026-chinh-thuc-duoc-nghi-mot-ngay-270980.html';
const S2027 = 'MoHA 11483/TB-BNV and the Labour Code; exchange calendar not yet published; https://cafef.vn/bo-noi-vu-thong-bao-chi-tiet-lich-nghi-tet-am-lich-quoc-khanh-2027-188261010120450778.chn';

function h(date: string, name: string, source: string, provisional = false): SeededHoliday {
  return { date, name, source, provisional };
}

export const VN_MARKET_HOLIDAYS: readonly SeededHoliday[] = [
  h('2025-01-01', "New Year's Day", S2025_NEWYEAR),
  h('2025-01-27', 'Tet Nguyen Dan (Tet At Ty)', S2025_TET),
  h('2025-01-28', 'Tet Nguyen Dan (Tet At Ty)', S2025_TET),
  h('2025-01-29', 'Tet Nguyen Dan (Tet At Ty)', S2025_TET),
  h('2025-01-30', 'Tet Nguyen Dan (Tet At Ty)', S2025_TET),
  h('2025-01-31', 'Tet Nguyen Dan (Tet At Ty)', S2025_TET),
  h('2025-04-07', "Hung Kings' Day", S2025),
  h('2025-04-30', 'Reunification Day', S2025),
  h('2025-05-01', 'International Labour Day', S2025),
  h('2025-05-02', 'Bridge day (swapped with Saturday 2025-04-26)', S2025),
  h('2025-09-01', 'National Day holiday', S2025_NATIONAL),
  h('2025-09-02', 'National Day', S2025_NATIONAL),
  h('2026-01-01', "New Year's Day", S2026_NEWYEAR),
  h('2026-01-02', 'Bridge day (swapped with Saturday 2026-01-10)', S2026_NEWYEAR),
  h('2026-02-16', 'Tet Nguyen Dan (Tet Binh Ngo)', S2026_TET),
  h('2026-02-17', 'Tet Nguyen Dan (Tet Binh Ngo)', S2026_TET),
  h('2026-02-18', 'Tet Nguyen Dan (Tet Binh Ngo)', S2026_TET),
  h('2026-02-19', 'Tet Nguyen Dan (Tet Binh Ngo)', S2026_TET),
  h('2026-02-20', 'Tet Nguyen Dan (Tet Binh Ngo)', S2026_TET),
  h('2026-04-27', "Hung Kings' Day (substitute for Sunday 2026-04-26)", S2026_HUNG),
  h('2026-04-30', 'Reunification Day', S2026_LABOUR),
  h('2026-05-01', 'International Labour Day', S2026_LABOUR),
  h('2026-08-31', 'Bridge day (swapped with Saturday 2026-08-22)', S2026_NATIONAL),
  h('2026-09-01', 'National Day holiday', S2026_NATIONAL),
  h('2026-09-02', 'National Day', S2026_NATIONAL),
  h('2026-11-24', 'Vietnamese Culture Day', S2026_CULTURE, true),
  h('2027-01-01', "New Year's Day", S2027, true),
  h('2027-02-04', 'Tet Nguyen Dan (Tet Dinh Mui)', S2027, true),
  h('2027-02-05', 'Tet Nguyen Dan (Tet Dinh Mui)', S2027, true),
  h('2027-02-08', 'Tet Nguyen Dan (Tet Dinh Mui)', S2027, true),
  h('2027-02-09', 'Tet Nguyen Dan (Tet Dinh Mui)', S2027, true),
  h('2027-02-10', 'Tet Nguyen Dan (Tet Dinh Mui)', S2027, true),
  h('2027-04-16', "Hung Kings' Day", S2027, true),
  h('2027-04-30', 'Reunification Day', S2027, true),
  h('2027-05-03', 'International Labour Day (substitute for Saturday 2027-05-01)', S2027, true),
  h('2027-09-02', 'National Day', S2027, true),
  h('2027-09-03', 'National Day holiday', S2027, true),
  h('2027-11-24', 'Vietnamese Culture Day', S2027, true),
];

export const SEEDED_HOLIDAY_DATES: readonly string[] = VN_MARKET_HOLIDAYS.map((x) => x.date);

export const SEEDED_HOLIDAY_YEARS: readonly number[] = [2025, 2026, 2027];

/**
 * Sorted, unique union of the seeded calendar and the dates stored in `settings.holidays`.
 * Empty or unset stored dates give exactly the seed; stored dates are kept.
 */
export function effectiveHolidays(stored: readonly string[] | null | undefined): string[] {
  return [...new Set([...SEEDED_HOLIDAY_DATES, ...(stored ?? [])])].sort();
}

/* Country flags for player labels. Codes are ISO 3166-1 alpha-2; the flag
   itself is the pair of regional-indicator characters that platforms
   render as an emoji flag (Windows shows the letters instead, which still
   reads fine). Names come from the browser's own locale data. */

const CODES =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW';

export const COUNTRY_CODES: readonly string[] = CODES.split(' ');

export function flagEmoji(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(0x1f1e6 + code.charCodeAt(0) - 65, 0x1f1e6 + code.charCodeAt(1) - 65);
}

let displayNames: Intl.DisplayNames | null | undefined;

export function countryName(code: string): string {
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' });
    } catch (error) {
      displayNames = null;
    }
  }
  try {
    return displayNames?.of(code) ?? code;
  } catch (error) {
    return code;
  }
}

export interface Country {
  code: string;
  name: string;
  flag: string;
}

let countries: Country[] | null = null;

/* Every country, sorted by name. */
export function listCountries(): Country[] {
  if (!countries) {
    countries = COUNTRY_CODES.map((code) => ({ code, name: countryName(code), flag: flagEmoji(code) }));
    countries.sort((a, b) => a.name.localeCompare(b.name));
  }
  return countries;
}

/* Best guess from the browser locale, e.g. en-GB gives GB. */
export function guessCountry(): string {
  try {
    const locale = new Intl.Locale(navigator.language).maximize();
    const region = locale.region ?? '';
    return COUNTRY_CODES.includes(region) ? region : '';
  } catch (error) {
    return '';
  }
}

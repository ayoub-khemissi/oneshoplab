import { describe, expect, it } from 'vitest';
import {
  languageFromHtml,
  languageFromText,
  resolveDetectedLanguage,
  textFromHtml
} from '@/entities/audit';

const FR_DESC =
  'Ce gel apaisant pour le corps est conçu avec de l aloe vera pour votre peau, sans parfum ' +
  'ajouté. Une formule naturelle qui hydrate les mains et le visage, pour une utilisation ' +
  'quotidienne. Cette crème est fabriquée en France et convient à toute la famille.';

describe('languageFromHtml', () => {
  it('reads the html tag, whatever the locale shape', () => {
    expect(languageFromHtml('<!doctype html><html lang="fr-FR" dir="ltr">')).toBe('fr');
    expect(languageFromHtml("<html class='x' lang='de'>")).toBe('de');
    expect(languageFromHtml('<html xml:lang="pt-BR">')).toBe('pt');
  });

  it('falls back to og:locale, either attribute order', () => {
    expect(languageFromHtml('<html><meta property="og:locale" content="es_ES">')).toBe('es');
    expect(languageFromHtml('<html><meta content="it_IT" property="og:locale">')).toBe('it');
  });

  it('says nothing rather than guessing', () => {
    expect(languageFromHtml('<html><body>bonjour</body></html>')).toBeNull();
    expect(languageFromHtml('<html lang="">')).toBeNull();
    expect(languageFromHtml('<html lang="zz">')).toBeNull();
    expect(languageFromHtml('')).toBeNull();
    expect(languageFromHtml(null)).toBeNull();
  });
});

describe('languageFromText', () => {
  it('weighs descriptions over titles', () => {
    expect(languageFromText([{ title: 'Dax Lanolin 397 g', text: FR_DESC }])).toBe('fr');
  });

  it('identifies a language by its script', () => {
    const ru = 'Этот крем для тела подходит для ежедневного использования и очень приятный';
    expect(languageFromText([{ text: ru }])).toBe('ru');
    const ja = 'このボディクリームは毎日のお手入れにぴったりで、肌をやさしく保湿します';
    expect(languageFromText([{ text: ja }])).toBe('ja');
  });

  it('reads a real English catalogue as English', () => {
    const en =
      'This soothing body gel is made with aloe vera for your skin and comes without added ' +
      'perfume. The natural formula hydrates the hands and the face, for daily use. This ' +
      'cream is made in France and is suitable for all the family.';
    expect(languageFromText([{ title: 'Aloe body gel', text: en }])).toBe('en');
  });

  it('admits it does not know instead of flipping a coin', () => {
    // Brand names only: the exact afrometis.com catalogue that shipped "en".
    const brands = [
      { title: 'dax lanolin 397 g', text: '' },
      { title: 'Dax Kocatah 397 g', text: '' },
      { title: 'Schwarzkopf - Natural & Easy - Permanent Hair Colour - Black 590', text: '' }
    ];
    expect(languageFromText(brands)).toBeNull();
    expect(languageFromText([])).toBeNull();
    expect(languageFromText([{ title: 'abc', text: 'x' }])).toBeNull();
  });
});

describe('languageFromText across close neighbours', () => {
  // Regression guard for the bug that shipped: "de" sat in the Dutch list,
  // French text scored Dutch nearly as high as French, the margin rule
  // cancelled the verdict and a French shop fell through to English.
  const SAMPLES: Array<[string, string]> = [
    [
      'fr',
      'Découvrez les produits que nous avons choisis pour votre peau, avec une formule sans ' +
        'parfum. Cette crème est fabriquée dans nos ateliers et convient à toute la famille.'
    ],
    [
      'es',
      'Descubre los productos que hemos elegido para tu piel, con una fórmula sin perfume. ' +
        'Esta crema del taller es muy suave, pero también protege más que las otras.'
    ],
    [
      'it',
      'Scopri questo prodotto della nostra selezione: gli ingredienti sono scelti nel ' +
        'laboratorio, anche per le pelli più delicate, e delle formule senza profumo.'
    ],
    [
      'pt',
      'Descubra uma seleção dos nossos produtos para a sua pele: não tem perfume, você ' +
        'encontra mais cuidado em cada um dos frascos e são feitos pelo nosso ateliê.'
    ],
    [
      'de',
      'Entdecken Sie die Produkte, die wir für Ihre Haut ausgewählt haben: eine Formel ohne ' +
        'Parfüm, das Handwerk ist nicht nur schonend, sondern auch für die ganze Familie.'
    ]
  ];

  for (const [code, text] of SAMPLES) {
    it(`reads ${code} as ${code}`, () => {
      expect(languageFromText([{ text }])).toBe(code);
    });
  }
});

describe('textFromHtml', () => {
  it('keeps the visible words and drops scripts, styles and markup', () => {
    const html =
      '<html><head><style>.a{color:red}</style><script>var x="hello world";</script></head>' +
      '<body><nav>Soin des cheveux</nav><p>Bienvenue dans notre magasin</p></body></html>';
    const text = textFromHtml(html);
    expect(text).toBe('Soin des cheveux Bienvenue dans notre magasin');
    expect(text).not.toContain('hello world');
    expect(text).not.toContain('color');
  });

  it('is bounded', () => {
    expect(textFromHtml(`<p>${'mot '.repeat(50_000)}</p>`, 100)).toHaveLength(100);
    expect(textFromHtml(null)).toBe('');
  });
});

describe('resolveDetectedLanguage', () => {
  const FRENCH_PAGE =
    'Bienvenue dans notre magasin. Soin des cheveux, crème pour les cheveux, gel douche et ' +
    'savon pour votre peau. Découvrez la sélection des produits que nous avons choisis avec ' +
    'soin pour toute la famille, sans parfum ajouté et fabriqués en France.';
  // A catalogue of imported names, as afrometis.com really has.
  const ENGLISH_CATALOGUE = Array.from({ length: 40 }, () => ({
    title: 'Schwarzkopf Natural and Easy Permanent Hair Colour with Olive Oil for the hair',
    text: 'Natural ingredients and olive oil for your hair, with the colour that lasts.'
  }));

  it('lets the page outweigh a catalogue of imported product names', () => {
    // The regression: mixed into one bag, forty English descriptions drown
    // the French home page and the whole shop is rewritten in English.
    expect(
      resolveDetectedLanguage({
        pageText: FRENCH_PAGE,
        products: ENGLISH_CATALOGUE,
        declared: 'en'
      })
    ).toBe('fr');
  });

  it('uses the catalogue when the page says nothing', () => {
    expect(resolveDetectedLanguage({ pageText: 'Afro Metis', products: ENGLISH_CATALOGUE })).toBe(
      'en'
    );
  });

  it('falls back to the declared language last, and stays null when blind', () => {
    const mute = [{ title: 'Dax Kocatah 397 g', text: '' }];
    expect(resolveDetectedLanguage({ products: mute, declared: 'de' })).toBe('de');
    expect(resolveDetectedLanguage({ products: mute })).toBeNull();
    expect(resolveDetectedLanguage({ declared: 'zz' })).toBeNull();
    expect(resolveDetectedLanguage({})).toBeNull();
  });
});

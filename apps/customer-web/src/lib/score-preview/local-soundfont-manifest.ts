const assets = Object.freeze({
  acoustic_grand_piano: Object.freeze({
    instrument: 'acoustic_grand_piano' as const,
    soundfont: 'MusyngKite' as const,
    format: 'mp3' as const,
    url: '/soundfonts/MusyngKite/acoustic_grand_piano-mp3.js',
  }),
});

export function requireLocalSoundfont(instrument: string) {
  if (!Object.hasOwn(assets, instrument)) {
    throw new Error(`unsupported_score_preview_instrument: ${instrument}`);
  }
  return assets[instrument as keyof typeof assets];
}

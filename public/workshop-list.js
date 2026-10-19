// Single source of truth for workshop attendance QR codes — edit only here.
// attend.html (scan page), workshop-qr.html (printable QR sheet) and
// dashboard.html (attendance panel) all load this. IDs must match WORKSHOPS
// in src/api/tickets.js and the ids in workshop-selection.html.
const TUC_WORKSHOPS = [
  { id: 'patch_it',    name: 'Patch It' },
  { id: 'plastic',     name: 'Plastic Pouch' },
  { id: 'owl_plushie', name: 'Owl Plushie' },
  { id: 'figurine',    name: 'Figurine Painting' },
  { id: 'charms',      name: 'Charms Keychain' },
];

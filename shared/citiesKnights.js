// Public, stable Cities & Knights progress card identities and rule summaries.
// The server owns card instances and deck order; this catalog contains no secrets.
export const CITIES_KNIGHTS_CARDS = Object.freeze({
  alchemy: { name: 'Alchemy', color: 'science', count: 2, art: 'alchemy', help: 'Before rolling, choose both production dice. Roll the event die normally.' },
  crane: { name: 'Crane', color: 'science', count: 2, art: 'crane', help: 'Build one city improvement for one fewer commodity.' },
  engineering: { name: 'Engineering', color: 'science', count: 1, art: 'engineering', help: 'Build one city wall for free.' },
  invention: { name: 'Invention', color: 'science', count: 2, art: 'invention', help: 'Exchange two number discs other than 2, 6, 8, or 12.' },
  irrigation: { name: 'Irrigation', color: 'science', count: 2, art: 'irrigation', help: 'Take two grain for each distinct fields hex beside one of your buildings.' },
  medicine: { name: 'Medicine', color: 'science', count: 2, art: 'medicine', help: 'Upgrade a settlement to a city for one grain and two ore.' },
  mining: { name: 'Mining', color: 'science', count: 2, art: 'mining', help: 'Take two ore for each distinct mountains hex beside one of your buildings.' },
  printing: { name: 'Printing', color: 'science', count: 1, art: 'printing', help: 'Gain one victory point immediately.' },
  roadBuilding: { name: 'Road Building', color: 'science', count: 2, art: 'road-building', help: 'Place two free roads or ships consecutively.' },
  smithing: { name: 'Smithing', color: 'science', count: 2, art: 'smithing', help: 'Promote up to two different knights one level for free.' },
  commercialHarbor: { name: 'Commercial Harbor', color: 'trade', count: 2, art: 'commercial-harbor', help: 'Offer one resource to each opponent once this turn for a commodity they choose.' },
  guildDues: { name: 'Guild Dues', color: 'trade', count: 2, art: 'guild-dues', help: 'Take up to two cards of your choice from a player with more victory points.' },
  merchant: { name: 'Merchant', color: 'trade', count: 6, art: 'merchant', help: 'Place the merchant beside your building for one victory point and 2:1 supply trade of that resource.' },
  merchantFleet: { name: 'Merchant Fleet', color: 'trade', count: 2, art: 'merchant-fleet', help: 'Choose one card type to trade 2:1 with the supply for the rest of this turn.' },
  resourceMonopoly: { name: 'Resource Monopoly', color: 'trade', count: 4, art: 'resource-monopoly', help: 'Take up to two of one named resource from every opponent.' },
  tradeMonopoly: { name: 'Trade Monopoly', color: 'trade', count: 2, art: 'trade-monopoly', help: 'Take one of one named commodity from every opponent.' },
  diplomacy: { name: 'Diplomacy', color: 'politics', count: 2, art: 'diplomacy', help: 'Remove an open road or ship. If it was yours, relocate that same piece for free.' },
  encouragement: { name: 'Encouragement', color: 'politics', count: 2, art: 'encouragement', help: 'Activate all your inactive knights for free.' },
  espionage: { name: 'Espionage', color: 'politics', count: 3, art: 'espionage', help: 'Inspect an opponent’s progress hand and optionally steal one ordinary card.' },
  intrigue: { name: 'Intrigue', color: 'politics', count: 2, art: 'intrigue', help: 'Displace an opponent knight connected to your route.' },
  sabotage: { name: 'Sabotage', color: 'politics', count: 2, art: 'sabotage', help: 'Each opponent with at least your victory points discards half their resource and commodity cards.' },
  taxation: { name: 'Taxation', color: 'politics', count: 2, art: 'taxation', help: 'Move the active robber and steal one random card from each adjacent opponent.' },
  treason: { name: 'Treason', color: 'politics', count: 2, art: 'treason', help: 'An opponent removes one knight; place one of your knights of equal or lower strength.' },
  constitution: { name: 'Constitution', color: 'politics', count: 1, art: 'constitution', help: 'Gain one victory point immediately.' },
  wedding: { name: 'Wedding', color: 'politics', count: 2, art: 'wedding', help: 'Each player with more victory points gives you two resource or commodity cards.' },
});

export const CITIES_KNIGHTS_CARD_TYPES = Object.freeze(Object.keys(CITIES_KNIGHTS_CARDS));

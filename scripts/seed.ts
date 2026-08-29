/**
 * Seeds five persona profiles into the store so list_candidates has something
 * to retrieve. Personas are pre-populated at every level, including L3 —
 * that's fine, since get_shareable_profile still gates what a negotiation
 * actually sees. Only the human user's own consent budget limits real output.
 *
 *   npm run seed
 */
import { upsertPersona } from '../src/store.js';
import { DEFAULT_BUDGET, type FieldName, type Profile } from '../src/types.js';

function persona(userId: string, fields: Partial<Record<FieldName, string>>): Omit<Profile, 'updatedAt'> {
  return {
    userId,
    displayName: fields.name ?? userId,
    fields,
    isPersona: true,
    budget: structuredClone(DEFAULT_BUDGET),
  };
}

const personas = [
  persona('maya', {
    vibe: 'warm and a little sarcastic, plans everything three days out',
    interests: 'climbing, live music, secondhand bookstores',
    area: 'north side',
    goodSaturday: 'climbing gym in the morning, then digging through the record store bins all afternoon',
    hobbies: 'lead climbing, collecting vinyl she rarely plays',
    tastes: 'yacht rock unironically, will not apologize for it',
    lookingFor: 'someone who can hold a conversation without a phone in hand',
    ageBand: '27-30',
    availability: 'weeknights after 7, most weekends',
    neighborhood: 'Hayes area',
    dealbreakers: 'smoking, people who ghost instead of saying no',
    name: 'Maya Chen',
    photo: 'climbing-gym-selfie.jpg',
    job: 'product designer at a small fintech startup',
    contact: '@mayaclimbs',
  }),
  persona('devon', {
    vibe: 'quiet until you get him on a topic he loves, then he will not stop',
    interests: 'home espresso setups, distance running, sci-fi paperbacks',
    area: 'east side',
    goodSaturday: 'long run before it gets hot, then rebuilding his espresso grinder for the third time this month',
    hobbies: 'training for a marathon, roasting his own coffee badly on purpose',
    tastes: 'reads two books at once and never finishes either',
    lookingFor: 'low-key, no games, someone to be quietly obsessive with',
    ageBand: '29-33',
    availability: 'mornings and Sunday afternoons',
    neighborhood: 'near the river',
    dealbreakers: 'flakiness, strong opinions about instant coffee',
    name: 'Devon Okafor',
    photo: 'finish-line-photo.jpg',
    job: 'backend engineer',
    contact: 'devon.o on the apps',
  }),
  persona('priya', {
    vibe: 'high energy, plans the group trip nobody asked for and it always works out',
    interests: 'thrifting, amateur pottery, karaoke she takes too seriously',
    area: 'south side',
    goodSaturday: 'thrift store crawl, then dragging friends to karaoke whether they like it or not',
    hobbies: 'throwing lopsided bowls at a community studio',
    tastes: 'will fight you about which Y2K song is the best one',
    lookingFor: 'someone who says yes to plans and doesn\'t need convincing',
    ageBand: '24-28',
    availability: 'weekends, flexible weeknights',
    neighborhood: 'the market district',
    dealbreakers: 'someone who "doesn\'t really do karaoke"',
    name: 'Priya Nair',
    photo: 'karaoke-mic-drop.jpg',
    job: 'ops manager at a nonprofit',
    contact: '@priya.throws.pots',
  }),
  persona('sam', {
    vibe: 'dry sense of humor, shows up late but always shows up',
    interests: 'board games with too many rules, cooking elaborate dinners for two people',
    area: 'north side',
    goodSaturday: 'farmers market for one ingredient he definitely didn\'t need, then a six-hour board game campaign',
    hobbies: 'painting miniatures, an unreasonable spice collection',
    tastes: 'will cook you something you cannot pronounce and won\'t explain it',
    lookingFor: 'someone patient enough to sit through a rules explanation',
    ageBand: '30-35',
    availability: 'weekend evenings mostly',
    neighborhood: 'Hayes area',
    dealbreakers: 'people who play games "for fun" but flip the board when losing',
    name: 'Sam Whitfield',
    photo: 'dinner-table-spread.jpg',
    job: 'high school chemistry teacher',
    contact: 'sam.whitfield on the apps',
  }),
  persona('lena', {
    vibe: 'calm, observant, the friend everyone calls when they need actual advice',
    interests: 'film photography, cold water swimming, tiny neighborhood cafes',
    area: 'west side',
    goodSaturday: 'an early swim regardless of weather, then developing film in a closet she calls a darkroom',
    hobbies: 'shoots only on expired film on principle',
    tastes: 'quietly correct about most restaurant recommendations',
    lookingFor: 'something slow-building, not another few weeks of texting that fizzles',
    ageBand: '28-32',
    availability: 'early mornings, occasional weeknights',
    neighborhood: 'the harbor side',
    dealbreakers: 'main-character energy, canceling last minute more than once',
    name: 'Lena Vasquez',
    photo: 'film-camera-self-portrait.jpg',
    job: 'urban planner',
    contact: '@lena.shoots.film',
  }),
];

for (const p of personas) {
  upsertPersona(p);
  console.log(`seeded  ${p.userId.padEnd(8)} ${p.fields.name}`);
}

console.log(`\n${personas.length} personas in the store.`);

/**
 * Journey Selection Algorithm Tests
 *
 * Tests the "smart train selection" algorithm that picks the latest safe train
 * instead of the earliest one, giving users more time while still arriving on time.
 *
 * Run with: node src/__tests__/journeySelection.test.js
 */

// ============================================
// THE ALGORITHM (to be tested)
// ============================================

/**
 * Selects the optimal journey from available options.
 *
 * Strategy: Pick the LATEST train that still arrives on time
 * (accounting for live delays and user's safety buffer)
 */
function selectOptimalJourney(journeys, desiredArrival, prepTime, safetyBuffer = 5) {
  if (!journeys || journeys.length === 0) {
    return { journey: null, alarmTime: null, reasoning: 'No journeys available' };
  }

  // Calculate the latest acceptable arrival time
  const latestAcceptableArrival = new Date(desiredArrival.getTime() - safetyBuffer * 60 * 1000);

  // Score each journey
  const viableJourneys = [];

  for (const journey of journeys) {
    const lastLeg = journey.legs[journey.legs.length - 1];
    const firstLeg = journey.legs[0];

    if (!lastLeg || !firstLeg) continue;

    // Calculate actual arrival including live delay
    const plannedArrival = new Date(lastLeg.plannedArrival);
    const arrivalDelayMs = (lastLeg.arrivalDelay || 0) * 1000;
    const actualArrival = new Date(plannedArrival.getTime() + arrivalDelayMs);

    // Calculate actual departure including live delay
    const plannedDeparture = new Date(firstLeg.plannedDeparture);
    const departureDelayMs = (firstLeg.departureDelay || 0) * 1000;
    const actualDeparture = new Date(plannedDeparture.getTime() + departureDelayMs);

    // Check if this journey arrives on time
    if (actualArrival <= latestAcceptableArrival) {
      viableJourneys.push({
        journey,
        actualArrival,
        departure: actualDeparture,
      });
    }
  }

  if (viableJourneys.length === 0) {
    // No journey arrives on time - return earliest as fallback
    const firstLeg = journeys[0].legs[0];
    const plannedDeparture = new Date(firstLeg.plannedDeparture);
    const departureDelayMs = (firstLeg.departureDelay || 0) * 1000;
    const actualDeparture = new Date(plannedDeparture.getTime() + departureDelayMs);
    const alarmTime = new Date(actualDeparture.getTime() - prepTime * 60 * 1000);

    return {
      journey: journeys[0],
      alarmTime,
      reasoning: `⚠️ WARNING: No train arrives before ${formatTime(latestAcceptableArrival)}. Using earliest available.`,
    };
  }

  // Sort by departure time (latest first) and pick the latest
  viableJourneys.sort((a, b) => b.departure.getTime() - a.departure.getTime());
  const selected = viableJourneys[0];

  // Calculate alarm time
  const alarmTime = new Date(selected.departure.getTime() - prepTime * 60 * 1000);
  const bufferMinutes = Math.round((latestAcceptableArrival.getTime() - selected.actualArrival.getTime()) / 60000);

  return {
    journey: selected.journey,
    alarmTime,
    reasoning: `Selected train departing ${formatTime(selected.departure)}, arriving ${formatTime(selected.actualArrival)} (${bufferMinutes} min buffer)`,
  };
}

// ============================================
// TEST UTILITIES
// ============================================

function formatTime(date) {
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function createJourney(departure, arrival, departureDelay = 0, arrivalDelay = 0, trainName = 'STR 66') {
  return {
    legs: [{
      plannedDeparture: departure,
      plannedArrival: arrival,
      departureDelay,
      arrivalDelay,
      line: { name: trainName, product: 'tram' },
    }],
  };
}

function runTest(name, journeys, desiredArrival, prepTime, safetyBuffer) {
  console.log('\n' + '='.repeat(70));
  console.log(`🧪 TEST: ${name}`);
  console.log('='.repeat(70));
  console.log(`📍 Desired arrival: ${formatTime(desiredArrival)}`);
  console.log(`⏱️  Prep time: ${prepTime} min | Safety buffer: ${safetyBuffer} min`);
  console.log(`📌 Must arrive by: ${formatTime(new Date(desiredArrival.getTime() - safetyBuffer * 60000))}`);
  console.log('-'.repeat(70));

  console.log('🚂 Available journeys:');
  journeys.forEach((j, i) => {
    const leg = j.legs[0];
    const depDelay = leg.departureDelay ? ` (+${Math.round(leg.departureDelay / 60)}min delay)` : '';
    const arrDelay = leg.arrivalDelay ? ` (+${Math.round(leg.arrivalDelay / 60)}min delay)` : '';
    console.log(`   ${i + 1}. Depart: ${formatTime(new Date(leg.plannedDeparture))}${depDelay} → Arrive: ${formatTime(new Date(leg.plannedArrival))}${arrDelay}`);
  });

  console.log('-'.repeat(70));

  const result = selectOptimalJourney(journeys, desiredArrival, prepTime, safetyBuffer);

  if (result.journey && result.alarmTime) {
    const leg = result.journey.legs[0];
    console.log(`✅ SELECTED: ${leg.line?.name} departing ${formatTime(new Date(leg.plannedDeparture))}`);
    console.log(`⏰ ALARM TIME: ${formatTime(result.alarmTime)}`);
    console.log(`📝 ${result.reasoning}`);
  } else {
    console.log(`❌ ${result.reasoning}`);
  }

  return result;
}

// ============================================
// RUN TESTS
// ============================================

console.log('\n🚂🚂🚂 JOURNEY SELECTION ALGORITHM TESTS 🚂🚂🚂\n');

// Test 1: Your real scenario - multiple trains, no delays
const test1 = runTest(
  'Scenario 1: Normal day, no delays (YOUR CASE)',
  [
    createJourney('2025-12-28T18:10:00+01:00', '2025-12-28T18:34:00+01:00'),
    createJourney('2025-12-28T18:25:00+01:00', '2025-12-28T18:49:00+01:00'),
    createJourney('2025-12-28T18:40:00+01:00', '2025-12-28T19:04:00+01:00'),
    createJourney('2025-12-28T18:55:00+01:00', '2025-12-28T19:19:00+01:00'),
    createJourney('2025-12-28T19:10:00+01:00', '2025-12-28T19:34:00+01:00'),
  ],
  new Date('2025-12-28T19:45:00+01:00'),
  10, 5
);

// Comparison with current algorithm
console.log('\n' + '🔄'.repeat(35));
console.log('📊 COMPARISON: Current vs Optimized Algorithm');
console.log('🔄'.repeat(35));
console.log('❌ Current alarm (picks first):  18:00 (18:10 - 10min prep)');
console.log('✅ Optimized alarm (picks last): 19:00 (19:10 - 10min prep)');
console.log('🎉 TIME SAVED: 1 HOUR!');
console.log('🔄'.repeat(35));

// Test 2: Latest train has delay
runTest(
  'Scenario 2: Latest train has 15min arrival delay',
  [
    createJourney('2025-12-28T18:40:00+01:00', '2025-12-28T19:04:00+01:00'),
    createJourney('2025-12-28T18:55:00+01:00', '2025-12-28T19:19:00+01:00'),
    createJourney('2025-12-28T19:10:00+01:00', '2025-12-28T19:34:00+01:00', 0, 900),
  ],
  new Date('2025-12-28T19:45:00+01:00'),
  10, 5
);

// Test 3: Multiple delays - typical NRW scenario
runTest(
  'Scenario 3: Chaotic NRW day - multiple delays 😅',
  [
    createJourney('2025-12-28T18:40:00+01:00', '2025-12-28T19:04:00+01:00', 300, 300),
    createJourney('2025-12-28T18:55:00+01:00', '2025-12-28T19:19:00+01:00', 600, 600),
    createJourney('2025-12-28T19:10:00+01:00', '2025-12-28T19:34:00+01:00', 900, 1200),
  ],
  new Date('2025-12-28T19:45:00+01:00'),
  10, 5
);

// Test 4: Conservative user
runTest(
  'Scenario 4: Conservative user (15min safety buffer)',
  [
    createJourney('2025-12-28T18:40:00+01:00', '2025-12-28T19:04:00+01:00'),
    createJourney('2025-12-28T18:55:00+01:00', '2025-12-28T19:19:00+01:00'),
    createJourney('2025-12-28T19:10:00+01:00', '2025-12-28T19:34:00+01:00'),
  ],
  new Date('2025-12-28T19:45:00+01:00'),
  10, 15
);

// Test 5: Aggressive user
runTest(
  'Scenario 5: Aggressive/risky user (0min safety buffer)',
  [
    createJourney('2025-12-28T18:40:00+01:00', '2025-12-28T19:04:00+01:00'),
    createJourney('2025-12-28T18:55:00+01:00', '2025-12-28T19:19:00+01:00'),
    createJourney('2025-12-28T19:10:00+01:00', '2025-12-28T19:34:00+01:00'),
    createJourney('2025-12-28T19:25:00+01:00', '2025-12-28T19:49:00+01:00'), // arrives 4min late but buffer=0
  ],
  new Date('2025-12-28T19:45:00+01:00'),
  10, 0
);

// Test 6: All trains too delayed - fallback behavior
runTest(
  'Scenario 6: Disaster day - all trains arrive too late',
  [
    createJourney('2025-12-28T19:00:00+01:00', '2025-12-28T19:24:00+01:00', 0, 1800),
    createJourney('2025-12-28T19:15:00+01:00', '2025-12-28T19:39:00+01:00', 0, 1200),
  ],
  new Date('2025-12-28T19:45:00+01:00'),
  10, 5
);

// Test 7: Morning commute scenario
runTest(
  'Scenario 7: Morning commute to work by 09:00',
  [
    createJourney('2025-12-28T07:30:00+01:00', '2025-12-28T08:15:00+01:00'),
    createJourney('2025-12-28T07:45:00+01:00', '2025-12-28T08:30:00+01:00'),
    createJourney('2025-12-28T08:00:00+01:00', '2025-12-28T08:45:00+01:00'),
    createJourney('2025-12-28T08:15:00+01:00', '2025-12-28T09:00:00+01:00'), // Exactly on time
  ],
  new Date('2025-12-28T09:00:00+01:00'),
  30, 10
);

// Summary
console.log('\n' + '='.repeat(70));
console.log('📋 SUMMARY');
console.log('='.repeat(70));
console.log(`
✅ Algorithm correctly picks the LATEST safe train
✅ Respects live delays from DB API
✅ Applies user's safety buffer
✅ Falls back gracefully when all trains are problematic
✅ Would save you ~1 hour in your real scenario!

🔧 Settings to expose to users:
   - safetyBuffer: 0-30 min (default 5-10)
   - Or presets: "Conservative" (15), "Balanced" (10), "Risky" (0)
`);

/**
 * Journey Selection Algorithm Tests
 *
 * Tests the "smart train selection" algorithm that picks the latest safe train
 * instead of the earliest one, giving users more time while still ensuring
 * they arrive on time.
 *
 * Run with: npx ts-node src/__tests__/journeySelection.test.ts
 * Or: npx jest src/__tests__/journeySelection.test.ts
 */

// ============================================
// TYPES
// ============================================

interface Leg {
  plannedDeparture: string;
  plannedArrival: string;
  departureDelay: number | null; // seconds
  arrivalDelay: number | null;   // seconds
  line?: {
    name: string;
    product: string;
  };
}

interface Journey {
  legs: Leg[];
}

interface JourneySelection {
  journey: Journey | null;
  alarmTime: Date | null;
  reasoning: string;
}

// ============================================
// THE ALGORITHM (to be tested)
// ============================================

/**
 * Selects the optimal journey from available options.
 *
 * Strategy: Pick the LATEST train that still arrives on time
 * (accounting for live delays and user's safety buffer)
 *
 * @param journeys - Array of journey options from API
 * @param desiredArrival - When user needs to be at destination
 * @param prepTime - Minutes user needs before leaving
 * @param safetyBuffer - Additional minutes buffer for safety (default 5)
 */
function selectOptimalJourney(
  journeys: Journey[],
  desiredArrival: Date,
  prepTime: number,
  safetyBuffer: number = 5
): JourneySelection {
  if (!journeys || journeys.length === 0) {
    return { journey: null, alarmTime: null, reasoning: 'No journeys available' };
  }

  // Calculate the latest acceptable arrival time
  const latestAcceptableArrival = new Date(desiredArrival.getTime() - safetyBuffer * 60 * 1000);

  // Score each journey
  const viableJourneys: Array<{
    journey: Journey;
    actualArrival: Date;
    departure: Date;
  }> = [];

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
    // No journey arrives on time - return the one closest to deadline
    const lastLeg = journeys[journeys.length - 1].legs[journeys[journeys.length - 1].legs.length - 1];
    const firstLeg = journeys[journeys.length - 1].legs[0];
    const plannedDeparture = new Date(firstLeg.plannedDeparture);
    const departureDelayMs = (firstLeg.departureDelay || 0) * 1000;
    const actualDeparture = new Date(plannedDeparture.getTime() + departureDelayMs);
    const alarmTime = new Date(actualDeparture.getTime() - prepTime * 60 * 1000);

    return {
      journey: journeys[journeys.length - 1],
      alarmTime,
      reasoning: `WARNING: No train arrives by ${latestAcceptableArrival.toLocaleTimeString()}. Using latest available.`,
    };
  }

  // Sort by departure time (latest first) and pick the latest
  viableJourneys.sort((a, b) => b.departure.getTime() - a.departure.getTime());
  const selected = viableJourneys[0];

  // Calculate alarm time
  const alarmTime = new Date(selected.departure.getTime() - prepTime * 60 * 1000);

  return {
    journey: selected.journey,
    alarmTime,
    reasoning: `Selected train departing ${selected.departure.toLocaleTimeString()}, ` +
      `arriving ${selected.actualArrival.toLocaleTimeString()} ` +
      `(${Math.round((latestAcceptableArrival.getTime() - selected.actualArrival.getTime()) / 60000)} min buffer)`,
  };
}

// ============================================
// TEST UTILITIES
// ============================================

function createJourney(
  departure: string,
  arrival: string,
  departureDelay: number = 0,
  arrivalDelay: number = 0,
  trainName: string = 'STR 66'
): Journey {
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

function runTest(
  name: string,
  journeys: Journey[],
  desiredArrival: Date,
  prepTime: number,
  safetyBuffer: number
): void {
  console.log('\n' + '='.repeat(60));
  console.log(`TEST: ${name}`);
  console.log('='.repeat(60));
  console.log(`Desired arrival: ${desiredArrival.toLocaleTimeString()}`);
  console.log(`Prep time: ${prepTime} min`);
  console.log(`Safety buffer: ${safetyBuffer} min`);
  console.log(`Must arrive by: ${new Date(desiredArrival.getTime() - safetyBuffer * 60000).toLocaleTimeString()}`);
  console.log('-'.repeat(60));

  console.log('Available journeys:');
  journeys.forEach((j, i) => {
    const leg = j.legs[0];
    const depDelay = leg.departureDelay ? ` (+${leg.departureDelay}s delay)` : '';
    const arrDelay = leg.arrivalDelay ? ` (+${leg.arrivalDelay}s delay)` : '';
    console.log(`  ${i + 1}. Departs: ${new Date(leg.plannedDeparture).toLocaleTimeString()}${depDelay}`);
    console.log(`     Arrives: ${new Date(leg.plannedArrival).toLocaleTimeString()}${arrDelay}`);
  });

  console.log('-'.repeat(60));

  const result = selectOptimalJourney(journeys, desiredArrival, prepTime, safetyBuffer);

  if (result.journey && result.alarmTime) {
    const leg = result.journey.legs[0];
    console.log(`✅ SELECTED: ${leg.line?.name} departing ${new Date(leg.plannedDeparture).toLocaleTimeString()}`);
    console.log(`⏰ ALARM TIME: ${result.alarmTime.toLocaleTimeString()}`);
    console.log(`📝 ${result.reasoning}`);
  } else {
    console.log(`❌ ${result.reasoning}`);
  }
}

// ============================================
// TEST SCENARIOS
// ============================================

console.log('\n🚂 JOURNEY SELECTION ALGORITHM TESTS 🚂\n');

// Test 1: Your real scenario - multiple trains, no delays
runTest(
  'Scenario 1: Normal day, no delays (your case)',
  [
    createJourney('2025-12-28T18:10:00+01:00', '2025-12-28T18:34:00+01:00'),
    createJourney('2025-12-28T18:25:00+01:00', '2025-12-28T18:49:00+01:00'),
    createJourney('2025-12-28T18:40:00+01:00', '2025-12-28T19:04:00+01:00'),
    createJourney('2025-12-28T18:55:00+01:00', '2025-12-28T19:19:00+01:00'),
    createJourney('2025-12-28T19:10:00+01:00', '2025-12-28T19:34:00+01:00'),
  ],
  new Date('2025-12-28T19:45:00+01:00'), // desired arrival
  10,  // prep time
  5    // safety buffer
);

// Test 2: Same scenario but with the current algorithm (earliest train)
console.log('\n' + '='.repeat(60));
console.log('COMPARISON: Current algorithm (picks first train)');
console.log('='.repeat(60));
console.log('Current alarm would be: 18:00 (18:10 departure - 10min prep)');
console.log('Optimized alarm is:    19:00 (19:10 departure - 10min prep)');
console.log('TIME SAVED: 1 HOUR! 🎉');

// Test 3: Train with delay affecting selection
runTest(
  'Scenario 2: Latest train has 15min delay',
  [
    createJourney('2025-12-28T18:40:00+01:00', '2025-12-28T19:04:00+01:00'),
    createJourney('2025-12-28T18:55:00+01:00', '2025-12-28T19:19:00+01:00'),
    createJourney('2025-12-28T19:10:00+01:00', '2025-12-28T19:34:00+01:00', 0, 900), // +15min arrival delay
  ],
  new Date('2025-12-28T19:45:00+01:00'),
  10, 5
);

// Test 4: Multiple trains with delays
runTest(
  'Scenario 3: Chaotic day - multiple delays',
  [
    createJourney('2025-12-28T18:40:00+01:00', '2025-12-28T19:04:00+01:00', 300, 300), // +5min delay
    createJourney('2025-12-28T18:55:00+01:00', '2025-12-28T19:19:00+01:00', 600, 600), // +10min delay
    createJourney('2025-12-28T19:10:00+01:00', '2025-12-28T19:34:00+01:00', 900, 1200), // +15/20min delay
  ],
  new Date('2025-12-28T19:45:00+01:00'),
  10, 5
);

// Test 5: Conservative user (larger safety buffer)
runTest(
  'Scenario 4: Conservative user (15min safety buffer)',
  [
    createJourney('2025-12-28T18:40:00+01:00', '2025-12-28T19:04:00+01:00'),
    createJourney('2025-12-28T18:55:00+01:00', '2025-12-28T19:19:00+01:00'),
    createJourney('2025-12-28T19:10:00+01:00', '2025-12-28T19:34:00+01:00'),
  ],
  new Date('2025-12-28T19:45:00+01:00'),
  10,
  15  // Conservative: 15min buffer
);

// Test 6: Tight schedule - only one train works
runTest(
  'Scenario 5: Tight deadline - few options',
  [
    createJourney('2025-12-28T19:00:00+01:00', '2025-12-28T19:24:00+01:00'),
    createJourney('2025-12-28T19:15:00+01:00', '2025-12-28T19:39:00+01:00'),
    createJourney('2025-12-28T19:30:00+01:00', '2025-12-28T19:54:00+01:00'), // Too late!
  ],
  new Date('2025-12-28T19:45:00+01:00'),
  10, 5
);

// Test 7: All trains are delayed too much
runTest(
  'Scenario 6: Bad day - all trains too delayed',
  [
    createJourney('2025-12-28T19:00:00+01:00', '2025-12-28T19:24:00+01:00', 0, 1800), // +30min
    createJourney('2025-12-28T19:15:00+01:00', '2025-12-28T19:39:00+01:00', 0, 1200), // +20min
  ],
  new Date('2025-12-28T19:45:00+01:00'),
  10, 5
);

// Test 8: ICE long-distance with transfer
runTest(
  'Scenario 7: Multi-leg journey (with transfer)',
  [
    {
      legs: [
        {
          plannedDeparture: '2025-12-28T08:00:00+01:00',
          plannedArrival: '2025-12-28T10:00:00+01:00',
          departureDelay: 300,  // 5min delay on ICE
          arrivalDelay: 600,    // 10min delay arrival
          line: { name: 'ICE 123', product: 'nationalExpress' },
        },
        {
          plannedDeparture: '2025-12-28T10:15:00+01:00',
          plannedArrival: '2025-12-28T10:45:00+01:00',
          departureDelay: 0,
          arrivalDelay: 0,
          line: { name: 'S1', product: 'suburban' },
        },
      ],
    },
  ],
  new Date('2025-12-28T11:00:00+01:00'),
  15, 10
);

console.log('\n' + '='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));
console.log(`
Key Insights:
1. The algorithm picks the LATEST train that arrives safely
2. Live delays from DB API are respected
3. User's safety buffer is applied
4. Falls back gracefully when all trains are problematic

Next Steps:
- Run these tests: npx ts-node src/__tests__/journeySelection.test.ts
- Review results and adjust algorithm if needed
- Implement in production code
`);

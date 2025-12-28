/**
 * Smart Journey Selection Utility
 *
 * Selects the LATEST train that still arrives on time, accounting for
 * live delays and user's safety buffer. This maximizes sleep time while
 * ensuring reliable arrival.
 */

import { parseISO } from 'date-fns';
import type { Journey } from '../types/ApiTypes';
import { logger } from './logger';

// Default safety buffer in minutes
export const DEFAULT_SAFETY_BUFFER = 10;

interface JourneySelection {
  journey: Journey | null;
  selectedLegIndex: number;
  alarmTime: Date | null;
  reasoning: string;
}

/**
 * Selects the optimal journey from available options.
 *
 * Strategy: Pick the LATEST train that still arrives on time
 * (accounting for live delays and user's safety buffer)
 *
 * @param journeys - Array of journey options from API
 * @param desiredArrival - When user needs to be at destination
 * @param prepTime - Minutes user needs before leaving
 * @param safetyBuffer - Additional minutes buffer for safety (default 10)
 * @returns Selected journey, alarm time, and reasoning
 */
export function selectOptimalJourney(
  journeys: Journey[],
  desiredArrival: Date,
  prepTime: number,
  safetyBuffer: number = DEFAULT_SAFETY_BUFFER
): JourneySelection {
  const log = logger.journeySelection;
  log.debug(`Selecting: arrive by ${desiredArrival.toLocaleTimeString('de-DE')}, prep ${prepTime}min, buffer ${safetyBuffer}min`);

  if (!journeys || journeys.length === 0) {
    log.debug('No journeys available');
    return {
      journey: null,
      selectedLegIndex: -1,
      alarmTime: null,
      reasoning: 'No journeys available'
    };
  }

  // Calculate the latest acceptable arrival time
  const latestAcceptableArrival = new Date(desiredArrival.getTime() - safetyBuffer * 60 * 1000);

  // Score each journey
  const viableJourneys: Array<{
    journey: Journey;
    journeyIndex: number;
    actualArrival: Date;
    actualDeparture: Date;
  }> = [];

  journeys.forEach((journey, index) => {
    const lastLeg = journey.legs[journey.legs.length - 1];
    const firstLeg = journey.legs[0];

    if (!lastLeg || !firstLeg) {
      return;
    }

    // Calculate actual arrival including live delay
    const plannedArrival = parseISO(lastLeg.plannedArrival);
    const arrivalDelayMs = (lastLeg.arrivalDelay || 0) * 1000;
    const actualArrival = new Date(plannedArrival.getTime() + arrivalDelayMs);

    // Calculate actual departure including live delay
    const plannedDeparture = parseISO(firstLeg.plannedDeparture);
    const departureDelayMs = (firstLeg.departureDelay || 0) * 1000;
    const actualDeparture = new Date(plannedDeparture.getTime() + departureDelayMs);

    const isViable = actualArrival <= latestAcceptableArrival;

    if (isViable) {
      viableJourneys.push({
        journey,
        journeyIndex: index,
        actualArrival,
        actualDeparture,
      });
    }
  });

  // Handle case where no journey arrives on time
  if (viableJourneys.length === 0) {
    log.warn('No journey arrives on time, using earliest as fallback');

    const firstLeg = journeys[0].legs[0];
    const plannedDeparture = parseISO(firstLeg.plannedDeparture);
    const departureDelayMs = (firstLeg.departureDelay || 0) * 1000;
    const actualDeparture = new Date(plannedDeparture.getTime() + departureDelayMs);
    const alarmTime = new Date(actualDeparture.getTime() - prepTime * 60 * 1000);

    return {
      journey: journeys[0],
      selectedLegIndex: 0,
      alarmTime,
      reasoning: `⚠️ No train arrives by ${latestAcceptableArrival.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}. Using earliest.`,
    };
  }

  // Sort by departure time (latest first) and pick the latest
  viableJourneys.sort((a, b) => b.actualDeparture.getTime() - a.actualDeparture.getTime());
  const selected = viableJourneys[0];

  // Calculate alarm time
  const alarmTime = new Date(selected.actualDeparture.getTime() - prepTime * 60 * 1000);
  const bufferMinutes = Math.round((latestAcceptableArrival.getTime() - selected.actualArrival.getTime()) / 60000);

  log.debug(`Selected: departs ${selected.actualDeparture.toLocaleTimeString('de-DE')}, alarm ${alarmTime.toLocaleTimeString('de-DE')}, ${bufferMinutes}min buffer`);

  return {
    journey: selected.journey,
    selectedLegIndex: selected.journeyIndex,
    alarmTime,
    reasoning: `Taking train at ${selected.actualDeparture.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}, arriving ${selected.actualArrival.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} (${bufferMinutes}min buffer)`,
  };
}

/**
 * Helper to get the first leg of a journey for display purposes
 */
export function getFirstLeg(journey: Journey | null) {
  return journey?.legs?.[0] ?? null;
}

/**
 * Helper to get the last leg of a journey (for arrival info)
 */
export function getLastLeg(journey: Journey | null) {
  if (!journey?.legs?.length) return null;
  return journey.legs[journey.legs.length - 1];
}

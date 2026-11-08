import type { Library, Place, Stop, Trip } from "@/lib/types";
import { legKey } from "@/lib/ids";

export const BANGKOK = {
  bkk: { lat: 13.681895, lon: 100.746861 },
  chatrium: { lat: 13.702567, lon: 100.53755 },
  watArun: { lat: 13.74361, lon: 100.48889 },
  iconsiam: { lat: 13.726694, lon: 100.510498 },
  centralWorld: { lat: 13.746944, lon: 100.539719 },
  asiatique: { lat: 13.706022, lon: 100.50466 },
  supanniga: { lat: 13.723122, lon: 100.527273 },
  baanKhanitha: { lat: 13.7231005745, lon: 100.5364619293 },
} as const;

const ids = {
  bkk: "loc-bkk",
  hotel: "loc-chatrium",
  wat: "loc-wat-arun",
  icon: "loc-iconsiam",
  world: "loc-centralworld",
  asia: "loc-asiatique",
  supa: "loc-supanniga",
  baan: "loc-baan-khanitha",
} as const;

function place(
  id: string,
  name: string,
  address: string,
  coord: { lat: number; lon: number },
  pinNote: string,
): Place {
  return { id, name, address, lat: coord.lat, lon: coord.lon, pinNote };
}

function stop(
  id: string,
  locationId: string,
  dayId: string,
  plannedTime: string,
  status: Stop["status"],
  notes: string,
  access: string,
): Stop {
  return { id, locationId, dayId, plannedTime, status, notes, access };
}

export function bangkokTrip(now: string): Trip {
  const days = [
    {
      id: "day-2026-12-08",
      date: "2026-12-08",
      title: "Arrival",
      notes:
        "Evening landing is a working assumption from a flight search, not a booked ticket. The return flight is still unresolved.",
    },
    {
      id: "day-2026-12-09",
      date: "2026-12-09",
      title: "Wat Arun and ICONSIAM",
      notes: "Proposed temple visit, lunch at the ICONSIAM complex, then back to the hotel.",
    },
    {
      id: "day-2026-12-10",
      date: "2026-12-10",
      title: "CentralWorld",
      notes:
        "Constitution Day. Check holiday hours. An optional appointment is not a separate stop and is not booked.",
    },
    {
      id: "day-2026-12-11",
      date: "2026-12-11",
      title: "Asiatique evening",
      notes: "Quieter midday at the hotel, then a short visit to the riverfront complex.",
    },
    {
      id: "day-2026-12-12",
      date: "2026-12-12",
      title: "Sathorn lunch",
      notes:
        "Proposed lunch out, then the hotel. A market morning or a class would replace this outing, not add a stop.",
    },
    {
      id: "day-2026-12-13",
      date: "2026-12-13",
      title: "Rest and dinner",
      notes:
        "Open day on purpose, with one proposed dinner. A full-day outing would replace this day, not be added on top.",
    },
    {
      id: "day-2026-12-14",
      date: "2026-12-14",
      title: "Departure",
      notes: "Return time is unresolved, so no pickup time is shown.",
    },
  ];

  const locations: Place[] = [
    place(
      ids.bkk,
      "Suvarnabhumi Airport (BKK)",
      "Suvarnabhumi Airport, Samut Prakan, Thailand",
      BANGKOK.bkk,
      "Facility reference for the airport, not a pickup curb or a specific accessible door.",
    ),
    place(
      ids.hotel,
      "Chatrium Residence Sathon",
      "291 Soi Naradhiwas Rajanagarindra 24, Bangkok",
      BANGKOK.chatrium,
      "Proposed home base for six nights, 8–14 December 2026. A deluxe three-bedroom layout was the working idea (about 140 m², lift, official maximum of six guests). Rate, availability, breakfast, and room access were not verified. Not booked.",
    ),
    place(
      ids.wat,
      "Wat Arun",
      "Wat Arun, Bangkok Yai, Bangkok",
      BANGKOK.watArun,
      "Temple-area coordinate. Not a guaranteed step-free entrance.",
    ),
    place(
      ids.icon,
      "ICONSIAM",
      "299 Charoen Nakhon Road, Bangkok",
      BANGKOK.iconsiam,
      "Complex-level pin. The proposed lunch is inside the mall, not at a separately verified door.",
    ),
    place(
      ids.world,
      "CentralWorld",
      "CentralWorld, Pathum Wan, Bangkok",
      BANGKOK.centralWorld,
      "Complex-level pin. Not a shop entrance, and not a clinic.",
    ),
    place(
      ids.asia,
      "Asiatique The Riverfront",
      "Asiatique The Riverfront, Charoen Krung, Bangkok",
      BANGKOK.asiatique,
      "Complex-level pin on the riverfront, including the proposed tea room. Not a specific shop door.",
    ),
    place(
      ids.supa,
      "Supanniga Eating Room, Sathorn 10",
      "28 Soi Sathorn 10, Bangkok",
      BANGKOK.supanniga,
      "Restaurant coordinate published from the restaurant's own map link. The entrance was not surveyed.",
    ),
    place(
      ids.baan,
      "Baan Khanitha Sathorn",
      "67/69 South Sathorn Road, Bangkok",
      BANGKOK.baanKhanitha,
      "Restaurant coordinate from a public listing for this Sathorn address. The entrance was not surveyed.",
    ),
  ];

  const hotelAccess = "Same property pin as the other hotel stops. Not a confirmed step-free entrance.";
  const stops: Stop[] = [
    stop(
      "stop-01",
      ids.bkk,
      "day-2026-12-08",
      "Evening arrival (search assumption, not a booked ticket)",
      "proposed",
      "Allow time for immigration and bags before the ride into the city. Planning notes often allow 60–120 minutes after landing, then the drive. That buffer is not a measurement from this map.",
      "Pin is a facility reference near Suvarnabhumi, not the pickup curb. Confirm the terminal door with the driver.",
    ),
    stop(
      "stop-02",
      ids.hotel,
      "day-2026-12-08",
      "Late evening, after the airport ride",
      "proposed",
      "Proposed check-in for six nights, not a reservation. Plan on a vehicle with room for six travelers plus a driver and luggage, not a standard car. Eat at the property only if something is open. No restaurant stop is planned tonight.",
      hotelAccess,
    ),
    stop(
      "stop-03",
      ids.wat,
      "day-2026-12-09",
      "10:30–11:30",
      "proposed",
      "Ground level is the proposal. Published hours are often 08:00–18:00 and an admission fee is commonly listed; recheck both. No entry reservation is held. Ceremonies published for 15–19 December fall after this window, but access can still change.",
      "Stairs and uneven stone are typical. This pin is not a guaranteed step-free entrance.",
    ),
    stop(
      "stop-04",
      ids.icon,
      "day-2026-12-09",
      "12:15 lunch",
      "proposed",
      "Lunch proposal at Nara inside ICONSIAM. One published branch schedule is 10:00–22:00. Confirm it, and do not treat the table as reserved.",
      "Mall-level coordinate. Step-free routes inside the complex were not checked.",
    ),
    stop(
      "stop-05",
      ids.hotel,
      "day-2026-12-09",
      "14:00–17:30 rest, dinner at the hotel",
      "proposed",
      "Return to the hotel. Dinner on site is an idea, not a booking.",
      hotelAccess,
    ),
    stop(
      "stop-06",
      ids.world,
      "day-2026-12-10",
      "Leave about 10:00",
      "proposed",
      "10 December is a public holiday. Confirm opening hours. Nara has a branch here. An optional half-day appointment is unbooked and is not its own pin.",
      "Complex-level coordinate. No clinic location is implied.",
    ),
    stop(
      "stop-07",
      ids.hotel,
      "day-2026-12-10",
      "About 13:30–14:30",
      "proposed",
      "Back to the hotel for the rest of the afternoon. Food can stay on site.",
      hotelAccess,
    ),
    stop(
      "stop-08",
      ids.hotel,
      "day-2026-12-11",
      "Midday rest, leave about 15:15",
      "buffer",
      "Same place as the previous stop. No ride is needed until Asiatique. Lunch is an on-site idea.",
      "No transfer. The pin does not move.",
    ),
    stop(
      "stop-09",
      ids.asia,
      "day-2026-12-11",
      "16:15 shops, tea room about 17:30",
      "proposed",
      "Short visit to selected shops, then Siam Tea Room in this complex (published address 2194 Charoen Krung). Ground-floor seating is not guaranteed. The complex often lists 11:00–00:00; individual shops vary.",
      "Complex-level coordinate, not a shop door or a guaranteed level entrance.",
    ),
    stop(
      "stop-10",
      ids.hotel,
      "day-2026-12-11",
      "About 19:00",
      "proposed",
      "Return to the hotel after dinner.",
      hotelAccess,
    ),
    stop(
      "stop-11",
      ids.supa,
      "day-2026-12-12",
      "11:45 lunch",
      "proposed",
      "Proposed regional lunch. Published hours for this room are 11:30–14:30 (last order 14:00) and 17:30–00:00 (last order 23:00). Recheck them. The table is not reserved. Chatuchak or a cooking class would replace this outing, not add a stop.",
      "Public restaurant coordinate. Entrance access was not surveyed.",
    ),
    stop(
      "stop-12",
      ids.hotel,
      "day-2026-12-12",
      "Afternoon rest, dinner at the hotel",
      "proposed",
      "Return after lunch.",
      hotelAccess,
    ),
    stop(
      "stop-13",
      ids.hotel,
      "day-2026-12-13",
      "Rest day, lunch at the hotel",
      "buffer",
      "Same place as the night before. The day stays open on purpose. A full-day trip out of the city, such as Ayutthaya, would replace this day. None is scheduled.",
      "No transfer.",
    ),
    stop(
      "stop-14",
      ids.baan,
      "day-2026-12-13",
      "18:00 dinner",
      "proposed",
      "Proposed farewell dinner at 67/69 South Sathorn. Published hours disagree across pages. Not reserved. A river cruise is not part of this plan.",
      "Listed coordinate for the restaurant, not a surveyed entrance.",
    ),
    stop(
      "stop-15",
      ids.hotel,
      "day-2026-12-13",
      "After dinner",
      "proposed",
      "Last night of the proposed stay. Checkout is the next day. Nothing is booked in this file.",
      hotelAccess,
    ),
    stop(
      "stop-16",
      ids.bkk,
      "day-2026-12-14",
      "Unresolved",
      "proposed",
      "No departure time and no dawn pickup are assumed. If the flight is late morning, lunch can stay at the hotel; otherwise eat toward the airport. Allow a long ride plus several hours at the airport. A route time, once shown, is a typical uncongested estimate.",
      "Same facility pin as arrival, not the departure drop-off door.",
    ),
  ];

  const legModes: Trip["legModes"] = {};
  for (let index = 1; index < stops.length; index += 1) {
    if (stops[index].locationId !== stops[index - 1].locationId) {
      legModes[legKey(stops[index - 1].id, stops[index].id)] = "driving";
    }
  }

  return {
    schemaVersion: 1,
    id: "trip-bangkok-2026-12-08",
    name: "Bangkok · 8–14 Dec 2026",
    summary:
      "Proposed six-night sketch. Sixteen ordered stops at eight places, with the hotel visited again on purpose. Two stops are same-place rest and do not ask for a road route. The hotel, flights, and tables are not bookings. Pins are area or property points, not guaranteed step-free entrances.",
    timezone: "Asia/Bangkok",
    status: "proposed",
    days,
    locations,
    stops,
    legModes,
    createdAt: now,
    updatedAt: now,
  };
}

export function sampleLibrary(now: string): Library {
  const trip = bangkokTrip(now);
  return {
    schemaVersion: 1,
    kind: "waymark.library",
    updatedAt: now,
    activeTripId: trip.id,
    trips: [trip],
  };
}

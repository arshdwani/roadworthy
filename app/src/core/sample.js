// Sample fleet: 25 vehicles over three depots, built from real manufacturer VIN patterns (WMI + VDS) with the check
// digit computed, so they decode in NHTSA vPIC and match live NHTSA campaigns, just like a real fleet would.
// Serial numbers are made up. `verifiedTo` is the date each vehicle's recall history was last checked at a dealer;
// only campaigns reported after it are considered. `equipment` is what the fleet knows that the VIN doesn't show
// (screen size, hitch, key type); Roadworthy uses it to rule campaigns in or out per vehicle.
import { withCheckDigit } from './vin.js';

// [unit, depot, VIN without check digit ("?" at position 9), plate, driver, verifiedTo, equipment]
const ROWS = [
  // North depot: parcel delivery vans
  ['VAN-101', 'North', '1FTBR1C8?LKA20562', '8NRT101', 'Dana Ortiz', '2026-01-01'],
  ['VAN-102', 'North', '1FTBR1C8?LKA20619', '8NRT102', 'Sam Patel', '2026-01-01'],
  ['VAN-103', 'North', '1FTBR1C8?LKA21044', '8NRT103', 'Lee Chen', '2021-12-01', 'factory cargo van, no conversions'],
  ['VAN-104', 'North', '1FTBR1C8?LKA21187', '8NRT104', '', '2021-12-01', 'factory cargo van, no conversions'],
  ['VAN-105', 'North', 'NM0LS7E2?K1401733', '8NRT105', 'Ava Brooks', '2021-05-01'],
  ['VAN-106', 'North', 'NM0LS7E7?K1402276', '8NRT106', 'Omar Haddad', '2025-05-01'],
  ['VAN-107', 'North', 'NM0LS7E2?K1403318', '8NRT107', 'Mia Novak', '2025-05-01'],
  ['VAN-108', 'North', '1GCWGAFP?L1160482', '8NRT108', 'Raj Iyer', '2024-01-01'],
  ['VAN-109', 'North', '1GCWGAFP?L1161905', '8NRT109', '', '2024-01-01'],
  // South depot: utility crews
  ['TRK-201', 'South', '1FTFW1E5?MFA10422', '7STH201', 'Jo Alvarez', '2026-06-01', '8-inch SYNC screen, tow hitch'],
  ['TRK-202', 'South', '1FTEW1EP?MKD10533', '7STH202', 'Kim Tran', '2026-07-01', '12-inch SYNC screen'],
  ['TRK-203', 'South', '1FTFW1E8?MFA11610', '7STH203', 'Ben Okafor', '2026-07-01', '12-inch SYNC screen, tow hitch'],
  ['TRK-204', 'South', '3FTTW8E3?NRA10234', '7STH204', 'Eli Moreau', '2026-03-01'],
  ['TRK-205', 'South', '3FTTW8F9?NRA10871', '7STH205', 'Zoe Park', '2026-03-01'],
  ['TRK-206', 'South', '3FMCR9B6?NRD10457', '7STH206', 'Ian Walsh', '2026-03-01'],
  // Airport depot: rental cars
  ['RNT-301', 'Airport', '4T1C11AK?MU510327', '9APT301', '', '2023-06-01'],
  ['RNT-302', 'Airport', '4T1G11AK?MU511944', '9APT302', '', '2024-01-01'],
  ['RNT-303', 'Airport', '4T1C11AK?MU512286', '9APT303', '', '2024-01-01'],
  ['RNT-304', 'Airport', '5N1AT2MT?LC703218', '9APT304', '', '2022-12-01', 'push-button start'],
  ['RNT-305', 'Airport', '5N1AT2MV?LC704455', '9APT305', '', '2024-01-01'],
  ['RNT-306', 'Airport', 'KM8J23A4?MU301277', '9APT306', '', '2024-01-01'],
  ['RNT-307', 'Airport', 'KM8J3CA4?MU302190', '9APT307', '', '2024-01-01'],
  ['RNT-308', 'Airport', 'KNDPM3AC?L7701482', '9APT308', '', '2022-06-01', 'no tow hitch'],
  ['RNT-309', 'Airport', '1G1FY6S0?L4102133', '9APT309', '', '2024-09-01'],
  ['RNT-310', 'Airport', '1G1FW6S0?L4102978', '9APT310', '', '2024-09-01'],
];

export const SAMPLE_FLEET = ROWS.map(([name, depot, vin, plate, driver, verifiedTo, equipment = '']) => ({
  name,
  depot,
  vin: withCheckDigit(vin.replace('?', '0')),
  plate,
  driver,
  verifiedTo,
  checkFrom: verifiedTo, // the sample's dealer history is complete up to verifiedTo: no "check once" window
  equipment,
}));

export const SAMPLE_DEPOTS = ['North', 'South', 'Airport'];

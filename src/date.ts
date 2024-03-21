interface File {
  name: string;
  modeTime: number;
  modeDate: number;
}

function toBinary(nb: number, bits: number): string {
  return nb.toString(2).padStart(bits, "0");
}

// Tailles des entiers lors du décalage : 32 bits

function parseTime({ modeTime, modeDate }: File): Date {
  // On garde les 7 premiers bits
  const year = modeDate >>> 9;
  // On supprime l'année
  // Puis on supprime les jours
  const month = (modeDate & 511) >>> 5;
  // On garde les 5 derniers bits.
  const day = modeDate & 31;
  // On garde les 5 premiers bits
  // En supprimant les minutes (6) et les secondes (5)
  const hours = modeTime >>> 11;
  // On supprime l'heure (5 bits)
  // Puis on supprime les secondes (5 bits).
  // 2047 = 2**11 - 1 = 2**(5+6) => Taille seconde + Taille minutes
  const minutes = (modeTime & 2047) >>> 5;
  // On garde les 5 derniers bits (32-27)
  const seconds = modeTime & 31;
  return new Date(1980 + year, month - 1, day, hours, minutes, seconds * 2);
}

/* modeTime */
//          5        6         5       => 16 bits
console.log(0b10111, 0b000001, 0b01001);
//          23       1         9        => 23 heure, 1 minutes, 9*2=18

/* modeDate */
//          7          4       5        => 16 bits
console.log(0b0101100, 0b0010, 0b01111);
//          44         2       15       => 1980 + 44 = 2024, 2e mois, 15e jour

const files: File[] = [
  // Modifié le: 2024-02-15 23:01:16.7104566
  {
    name: "src/central-directory.ts",
    modeTime: 0b1011100000101001,
    modeDate: 0b0101100001001111,
  },
  // Modifié le: 2024-02-15 23:00:51.8628371
  {
    name: "src/utils.ts",
    modeTime: 0b1011100000011010,
    modeDate: 0b0101100001001111,
  },
  // Modifié le: 2024-02-16 00:41:26.0397054
  {
    name: "src/zip.ts",
    modeTime: 0b0000010100101110,
    modeDate: 0b0101100001010000,
  },
];
const dtFormat = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "medium",
});
for (const f of files) {
  console.log(f.name, dtFormat.format(parseTime(f)));
}

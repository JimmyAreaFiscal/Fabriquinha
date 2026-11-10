export function somar(a: number, b: number): number {
  return a + b;
}

if (import.meta.main) {
  const [a = "0", b = "0"] = process.argv.slice(2);
  console.log(somar(Number(a), Number(b)));
}

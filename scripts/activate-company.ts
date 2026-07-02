// Manually activate a company's subscription (stand-in until Stripe lands).
//
//   npm run activate:company -- <companyId-or-exact-name> [months]
//
// Sets subscriptionStatus=ACTIVE and subscriptionEndsAt=now+months (default 1).
// Run locally by the operator only — deliberately not exposed over HTTP.
import { prisma } from '../src/lib/prisma';

async function main(): Promise<void> {
  const [identifier, monthsArg] = process.argv.slice(2);
  if (!identifier) {
    console.error('Usage: npm run activate:company -- <companyId-or-exact-name> [months]');
    process.exit(1);
  }
  const months = monthsArg ? Number(monthsArg) : 1;
  if (!Number.isFinite(months) || months <= 0) {
    console.error(`Invalid months value: ${monthsArg}`);
    process.exit(1);
  }

  const company = await prisma.company.findFirst({
    where: { OR: [{ id: identifier }, { name: identifier }] },
  });
  if (!company) {
    console.error(`No company found with id or name: ${identifier}`);
    process.exit(1);
  }

  const endsAt = new Date();
  endsAt.setMonth(endsAt.getMonth() + months);

  await prisma.company.update({
    where: { id: company.id },
    data: { subscriptionStatus: 'ACTIVE', subscriptionEndsAt: endsAt },
  });

  console.log(`Activated "${company.name}" (${company.id}) until ${endsAt.toISOString()}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

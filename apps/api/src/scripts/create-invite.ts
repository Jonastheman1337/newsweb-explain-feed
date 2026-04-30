import { prisma } from "@newsweb/shared/db";

async function main(): Promise<void> {
  const email = process.argv[2]?.toLowerCase();
  if (!email || !email.includes("@")) {
    console.error("Usage: npm run invite:add -w apps/api -- user@example.com");
    process.exit(1);
  }

  await prisma.invite.upsert({
    where: { email },
    create: { email },
    update: {}
  });

  console.log(`Invite ready for ${email}`);
}

void main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

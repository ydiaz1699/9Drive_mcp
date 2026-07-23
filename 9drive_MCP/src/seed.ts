/**
 * Script de seed: Crea un usuario inicial para pruebas.
 * Uso: npm run seed
 */
import { prisma } from "./lib/prisma.js";
import { config } from "./lib/config.js";
import { createHash } from "crypto";

async function main() {
  console.log("🌱 Creando datos iniciales...\n");

  // Crear usuario de prueba
  const testUser = await prisma.user.upsert({
    where: { email: "admin@9drive.local" },
    update: {},
    create: {
      email: "admin@9drive.local",
      name: "Admin",
      passwordHash: createHash("sha256").update("admin123").digest("hex"),
    },
  });

  console.log(`✅ Usuario creado:`);
  console.log(`   ID:    ${testUser.id}`);
  console.log(`   Email: ${testUser.email}`);
  console.log(`   Nombre: ${testUser.name}`);
  console.log("");
  console.log("📋 Usa este userId en las tools del MCP:");
  console.log(`   "${testUser.id}"`);
  console.log("");

  // Guardar config de Google si está disponible
  if (config.google.clientId && config.google.clientSecret) {
    const { encrypt } = await import("./lib/encryption.js");
    await prisma.globalConfig.upsert({
      where: { key: "google_oauth" },
      update: {
        value: encrypt(
          JSON.stringify({
            clientId: config.google.clientId,
            clientSecret: config.google.clientSecret,
            redirectUri: config.google.redirectUri,
          })
        ),
      },
      create: {
        key: "google_oauth",
        value: encrypt(
          JSON.stringify({
            clientId: config.google.clientId,
            clientSecret: config.google.clientSecret,
            redirectUri: config.google.redirectUri,
          })
        ),
      },
    });
    console.log("✅ Configuración de Google OAuth guardada en DB");
  } else {
    console.log("⚠️  GOOGLE_CLIENT_ID/SECRET no configurados. Configúralos en .env");
  }

  console.log("\n🎉 Seed completado!");
}

main()
  .catch((e) => {
    console.error("❌ Error en seed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

-- One-time development setup. Run from Backend/ as a Windows administrator:
--   sqlcmd -S localhost -E -i scripts/setup-db.sql -v AppPassword="ShiftDev2026x"
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'shiftreporting_app')
  CREATE LOGIN shiftreporting_app WITH PASSWORD = '$(AppPassword)', CHECK_POLICY = OFF;
ELSE
  ALTER LOGIN shiftreporting_app WITH PASSWORD = '$(AppPassword)';
GO
-- Development only: `prisma migrate dev` creates a temporary "shadow" database.
-- Never grant this role in production.
ALTER SERVER ROLE dbcreator ADD MEMBER shiftreporting_app;
GO
IF DB_ID('shiftreporting') IS NULL CREATE DATABASE shiftreporting;
GO
IF DB_ID('shiftreporting_test') IS NULL CREATE DATABASE shiftreporting_test;
GO
USE shiftreporting;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'shiftreporting_app')
  CREATE USER shiftreporting_app FOR LOGIN shiftreporting_app;
ALTER ROLE db_owner ADD MEMBER shiftreporting_app;
GO
USE shiftreporting_test;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'shiftreporting_app')
  CREATE USER shiftreporting_app FOR LOGIN shiftreporting_app;
ALTER ROLE db_owner ADD MEMBER shiftreporting_app;
GO

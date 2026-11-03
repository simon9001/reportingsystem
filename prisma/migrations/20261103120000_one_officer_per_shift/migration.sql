BEGIN TRY

BEGIN TRAN;

-- The check constraint references the column, so it has to be dropped while the column changes.
ALTER TABLE [dbo].[Shift] DROP CONSTRAINT [Shift_supervisor_officer_differ];

-- AlterTable
ALTER TABLE [dbo].[Shift] ALTER COLUMN [officerId] INT NULL;

ALTER TABLE [dbo].[Shift] ADD CONSTRAINT [Shift_supervisor_officer_differ] CHECK ([supervisorId] <> [officerId]);

-- A shift has one officer from now on. Shifts that have not started keep only their officer on duty; earlier ones keep their history.
EXEC('UPDATE [dbo].[Shift] SET [officerId] = NULL WHERE [startsAt] > SYSUTCDATETIME();');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

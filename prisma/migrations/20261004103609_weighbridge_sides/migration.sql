/*
  Warnings:

  - The primary key for the `IncidentSequence` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Incident] ALTER COLUMN [locationId] INT NULL;
ALTER TABLE [dbo].[Incident] ADD [dashcamStatus] NVARCHAR(10),
[gpsStatus] NVARCHAR(10),
[locationText] NVARCHAR(100),
[platformId] INT,
[remarks] NVARCHAR(2000),
[side] NVARCHAR(10) NOT NULL CONSTRAINT [Incident_side_df] DEFAULT 'STATIC',
[vehicleId] INT,
[vehicleStatus] NVARCHAR(10);

-- AlterTable
ALTER TABLE [dbo].[IncidentSequence] ADD [prefix] NVARCHAR(5) NOT NULL CONSTRAINT [IncidentSequence_prefix_df] DEFAULT 'INC';
ALTER TABLE [dbo].[IncidentSequence] DROP CONSTRAINT [IncidentSequence_pkey];
-- Existing rows keep their counters: the new column defaults to 'INC'. EXEC defers compiling until the column exists.
EXEC('ALTER TABLE [dbo].[IncidentSequence] ADD CONSTRAINT IncidentSequence_pkey PRIMARY KEY CLUSTERED ([prefix],[year])');

-- CreateIndex
CREATE NONCLUSTERED INDEX [Incident_side_occurredAt_idx] ON [dbo].[Incident]([side], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Incident_vehicleId_idx] ON [dbo].[Incident]([vehicleId]);

-- AddForeignKey
ALTER TABLE [dbo].[Incident] ADD CONSTRAINT [Incident_vehicleId_fkey] FOREIGN KEY ([vehicleId]) REFERENCES [dbo].[Vehicle]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Incident] ADD CONSTRAINT [Incident_platformId_fkey] FOREIGN KEY ([platformId]) REFERENCES [dbo].[LookupItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

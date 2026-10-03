BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Incident] (
    [id] INT NOT NULL IDENTITY(1,1),
    [ref] NVARCHAR(20) NOT NULL,
    [shiftId] INT NOT NULL,
    [shiftCode] NVARCHAR(20) NOT NULL,
    [occurredAt] DATETIME2 NOT NULL,
    [occurredLocalDate] DATE NOT NULL,
    [locationId] INT NOT NULL,
    [locationDetail] NVARCHAR(200),
    [categoryId] INT NOT NULL,
    [severity] NVARCHAR(20) NOT NULL,
    [severityRank] INT NOT NULL,
    [reportedById] INT NOT NULL,
    [description] NVARCHAR(2000) NOT NULL,
    [immediateAction] NVARCHAR(2000),
    [escalatedTo] NVARCHAR(200),
    [escalatedAt] DATETIME2,
    [assignedTo] NVARCHAR(200),
    [status] NVARCHAR(20) NOT NULL,
    [resolvedAt] DATETIME2,
    [resolution] NVARCHAR(2000),
    [minutesToResolve] INT,
    [escalationResult] NVARCHAR(20) NOT NULL,
    [escalationMinutes] INT,
    [createdById] INT NOT NULL,
    [updatedById] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Incident_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Incident_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Incident_ref_key] UNIQUE NONCLUSTERED ([ref])
);

-- CreateTable
CREATE TABLE [dbo].[IncidentAttachment] (
    [id] INT NOT NULL IDENTITY(1,1),
    [incidentId] INT NOT NULL,
    [storedName] NVARCHAR(200) NOT NULL,
    [originalName] NVARCHAR(255) NOT NULL,
    [mimeType] NVARCHAR(100) NOT NULL,
    [sizeBytes] INT NOT NULL,
    [uploadedById] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [IncidentAttachment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [IncidentAttachment_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [IncidentAttachment_storedName_key] UNIQUE NONCLUSTERED ([storedName])
);

-- CreateTable
CREATE TABLE [dbo].[IncidentEvent] (
    [id] INT NOT NULL IDENTITY(1,1),
    [incidentId] INT NOT NULL,
    [userId] INT,
    [kind] NVARCHAR(30) NOT NULL,
    [summary] NVARCHAR(300) NOT NULL,
    [at] DATETIME2 NOT NULL CONSTRAINT [IncidentEvent_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [IncidentEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[IncidentSequence] (
    [year] INT NOT NULL,
    [lastNumber] INT NOT NULL,
    CONSTRAINT [IncidentSequence_pkey] PRIMARY KEY CLUSTERED ([year])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Incident_occurredAt_idx] ON [dbo].[Incident]([occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Incident_occurredLocalDate_idx] ON [dbo].[Incident]([occurredLocalDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Incident_shiftId_idx] ON [dbo].[Incident]([shiftId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Incident_status_idx] ON [dbo].[Incident]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Incident_severity_idx] ON [dbo].[Incident]([severity]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Incident_categoryId_locationId_occurredAt_idx] ON [dbo].[Incident]([categoryId], [locationId], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IncidentAttachment_incidentId_idx] ON [dbo].[IncidentAttachment]([incidentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IncidentEvent_incidentId_at_idx] ON [dbo].[IncidentEvent]([incidentId], [at]);

-- AddForeignKey
ALTER TABLE [dbo].[Incident] ADD CONSTRAINT [Incident_shiftId_fkey] FOREIGN KEY ([shiftId]) REFERENCES [dbo].[Shift]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Incident] ADD CONSTRAINT [Incident_locationId_fkey] FOREIGN KEY ([locationId]) REFERENCES [dbo].[LookupItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Incident] ADD CONSTRAINT [Incident_categoryId_fkey] FOREIGN KEY ([categoryId]) REFERENCES [dbo].[LookupItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Incident] ADD CONSTRAINT [Incident_reportedById_fkey] FOREIGN KEY ([reportedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Incident] ADD CONSTRAINT [Incident_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Incident] ADD CONSTRAINT [Incident_updatedById_fkey] FOREIGN KEY ([updatedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[IncidentAttachment] ADD CONSTRAINT [IncidentAttachment_incidentId_fkey] FOREIGN KEY ([incidentId]) REFERENCES [dbo].[Incident]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[IncidentAttachment] ADD CONSTRAINT [IncidentAttachment_uploadedById_fkey] FOREIGN KEY ([uploadedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[IncidentEvent] ADD CONSTRAINT [IncidentEvent_incidentId_fkey] FOREIGN KEY ([incidentId]) REFERENCES [dbo].[Incident]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[IncidentEvent] ADD CONSTRAINT [IncidentEvent_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

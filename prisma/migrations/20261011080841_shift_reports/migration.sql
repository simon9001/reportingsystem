BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[ShiftReport] (
    [id] INT NOT NULL IDENTITY(1,1),
    [shiftId] INT NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [ShiftReport_status_df] DEFAULT 'DRAFT',
    [overallStatus] NVARCHAR(20),
    [overview] NVARCHAR(4000),
    [keyEvents] NVARCHAR(4000),
    [pendingActions] NVARCHAR(4000),
    [operationalConcerns] NVARCHAR(4000),
    [recommendations] NVARCHAR(4000),
    [confirmReviewed] BIT NOT NULL CONSTRAINT [ShiftReport_confirmReviewed_df] DEFAULT 0,
    [confirmEscalated] BIT NOT NULL CONSTRAINT [ShiftReport_confirmEscalated_df] DEFAULT 0,
    [confirmHandedOver] BIT NOT NULL CONSTRAINT [ShiftReport_confirmHandedOver_df] DEFAULT 0,
    [confirmSubmitted] BIT NOT NULL CONSTRAINT [ShiftReport_confirmSubmitted_df] DEFAULT 0,
    [submittedById] INT,
    [submittedAt] DATETIME2,
    [timeliness] NVARCHAR(10),
    [lateMinutes] INT,
    [snapshotJson] NVARCHAR(max),
    [pdfStoredName] NVARCHAR(200),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ShiftReport_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ShiftReport_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ShiftReport_shiftId_key] UNIQUE NONCLUSTERED ([shiftId])
);

-- CreateTable
CREATE TABLE [dbo].[EmailJob] (
    [id] INT NOT NULL IDENTITY(1,1),
    [type] NVARCHAR(40) NOT NULL,
    [reportId] INT,
    [shiftId] INT,
    [to] NVARCHAR(320) NOT NULL,
    [status] NVARCHAR(30) NOT NULL CONSTRAINT [EmailJob_status_df] DEFAULT 'PENDING',
    [attempts] INT NOT NULL CONSTRAINT [EmailJob_attempts_df] DEFAULT 0,
    [nextAttemptAt] DATETIME2 NOT NULL CONSTRAINT [EmailJob_nextAttemptAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lockedAt] DATETIME2,
    [lastError] NVARCHAR(1000),
    [sentAt] DATETIME2,
    [dedupeKey] NVARCHAR(200) NOT NULL,
    [createdById] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [EmailJob_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [EmailJob_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [EmailJob_dedupeKey_key] UNIQUE NONCLUSTERED ([dedupeKey])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ShiftReport_status_idx] ON [dbo].[ShiftReport]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EmailJob_status_nextAttemptAt_idx] ON [dbo].[EmailJob]([status], [nextAttemptAt]);

-- AddForeignKey
ALTER TABLE [dbo].[ShiftReport] ADD CONSTRAINT [ShiftReport_shiftId_fkey] FOREIGN KEY ([shiftId]) REFERENCES [dbo].[Shift]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ShiftReport] ADD CONSTRAINT [ShiftReport_submittedById_fkey] FOREIGN KEY ([submittedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EmailJob] ADD CONSTRAINT [EmailJob_reportId_fkey] FOREIGN KEY ([reportId]) REFERENCES [dbo].[ShiftReport]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

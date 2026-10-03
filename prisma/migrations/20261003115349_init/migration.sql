BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[User] (
    [id] INT NOT NULL IDENTITY(1,1),
    [fullName] NVARCHAR(120) NOT NULL,
    [email] NVARCHAR(200) NOT NULL,
    [passwordHash] NVARCHAR(200) NOT NULL,
    [role] NVARCHAR(20) NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [User_isActive_df] DEFAULT 1,
    [mustChangePassword] BIT NOT NULL CONSTRAINT [User_mustChangePassword_df] DEFAULT 1,
    [lastLoginAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [User_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [User_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [User_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[Session] (
    [id] NVARCHAR(64) NOT NULL,
    [userId] INT NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [ip] NVARCHAR(64),
    [userAgent] NVARCHAR(300),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Session_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Session_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ShiftDefinition] (
    [id] INT NOT NULL IDENTITY(1,1),
    [code] NVARCHAR(20) NOT NULL,
    [name] NVARCHAR(50) NOT NULL,
    [startTime] NVARCHAR(5) NOT NULL,
    [endTime] NVARCHAR(5) NOT NULL,
    [sortOrder] INT NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [ShiftDefinition_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ShiftDefinition_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ShiftDefinition_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ShiftDefinition_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[EscalationRule] (
    [id] INT NOT NULL IDENTITY(1,1),
    [severity] NVARCHAR(20) NOT NULL,
    [isRequired] BIT NOT NULL,
    [notifyWho] NVARCHAR(200),
    [withinMinutes] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [EscalationRule_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [EscalationRule_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [EscalationRule_severity_key] UNIQUE NONCLUSTERED ([severity])
);

-- CreateTable
CREATE TABLE [dbo].[SystemSetting] (
    [key] NVARCHAR(100) NOT NULL,
    [value] NVARCHAR(1000) NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SystemSetting_pkey] PRIMARY KEY CLUSTERED ([key])
);

-- CreateTable
CREATE TABLE [dbo].[LookupItem] (
    [id] INT NOT NULL IDENTITY(1,1),
    [listType] NVARCHAR(20) NOT NULL,
    [value] NVARCHAR(100) NOT NULL,
    [sortOrder] INT NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [LookupItem_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [LookupItem_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [LookupItem_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [LookupItem_listType_value_key] UNIQUE NONCLUSTERED ([listType],[value])
);

-- CreateTable
CREATE TABLE [dbo].[Vehicle] (
    [id] INT NOT NULL IDENTITY(1,1),
    [unitId] NVARCHAR(50) NOT NULL,
    [description] NVARCHAR(200),
    [isActive] BIT NOT NULL CONSTRAINT [Vehicle_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Vehicle_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Vehicle_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Vehicle_unitId_key] UNIQUE NONCLUSTERED ([unitId])
);

-- CreateTable
CREATE TABLE [dbo].[Shift] (
    [id] INT NOT NULL IDENTITY(1,1),
    [shiftDate] DATE NOT NULL,
    [shiftDefinitionId] INT NOT NULL,
    [startsAt] DATETIME2 NOT NULL,
    [endsAt] DATETIME2 NOT NULL,
    [supervisorId] INT NOT NULL,
    [officerId] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Shift_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Shift_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Shift_shiftDate_shiftDefinitionId_key] UNIQUE NONCLUSTERED ([shiftDate],[shiftDefinitionId])
);

-- CreateTable
CREATE TABLE [dbo].[AuditLog] (
    [id] INT NOT NULL IDENTITY(1,1),
    [userId] INT,
    [entity] NVARCHAR(50) NOT NULL,
    [entityId] NVARCHAR(50),
    [action] NVARCHAR(20) NOT NULL,
    [beforeJson] NVARCHAR(max),
    [afterJson] NVARCHAR(max),
    [ip] NVARCHAR(64),
    [at] DATETIME2 NOT NULL CONSTRAINT [AuditLog_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AuditLog_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Session_userId_idx] ON [dbo].[Session]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Shift_startsAt_endsAt_idx] ON [dbo].[Shift]([startsAt], [endsAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_entity_entityId_idx] ON [dbo].[AuditLog]([entity], [entityId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_at_idx] ON [dbo].[AuditLog]([at]);

-- AddForeignKey
ALTER TABLE [dbo].[Session] ADD CONSTRAINT [Session_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Shift] ADD CONSTRAINT [Shift_shiftDefinitionId_fkey] FOREIGN KEY ([shiftDefinitionId]) REFERENCES [dbo].[ShiftDefinition]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Shift] ADD CONSTRAINT [Shift_supervisorId_fkey] FOREIGN KEY ([supervisorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Shift] ADD CONSTRAINT [Shift_officerId_fkey] FOREIGN KEY ([officerId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AuditLog] ADD CONSTRAINT [AuditLog_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

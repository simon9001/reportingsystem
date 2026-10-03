-- A person cannot be both Shift Supervisor and Control Room Officer on the same shift.
ALTER TABLE [dbo].[Shift] ADD CONSTRAINT [Shift_supervisor_officer_differ] CHECK ([supervisorId] <> [officerId]);

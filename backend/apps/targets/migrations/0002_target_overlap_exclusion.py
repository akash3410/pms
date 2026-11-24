"""DB-level guard against overlapping targets (POMS-AUDIT-006).

Adds a PostgreSQL exclusion constraint so two targets for the same employee and
``period_type`` can never have overlapping ``[start_date, end_date]`` ranges,
even under concurrency or via a code path that bypasses the service-layer check.

Prerequisite: the ``btree_gist`` extension (trusted in PostgreSQL 13+; provides
the ``=`` gist operator class for ``uuid``/``varchar``). It is created here with
``IF NOT EXISTS``. On managed PostgreSQL the role needs permission to install it
(or it must be pre-installed by an administrator).

This is a database-only constraint (not declared in model ``Meta``), so it does
not appear in Django migration state and is intentionally managed by this
migration only.
"""
from django.db import migrations

EXCLUSION_SQL = """
ALTER TABLE targets_employeetarget
    ADD CONSTRAINT uniq_target_no_overlap
    EXCLUDE USING gist (
        employee_id WITH =,
        period_type WITH =,
        daterange(start_date, end_date, '[]') WITH &&
    );
"""

REVERSE_SQL = """
ALTER TABLE targets_employeetarget
    DROP CONSTRAINT IF EXISTS uniq_target_no_overlap;
"""


class Migration(migrations.Migration):
    dependencies = [
        ("targets", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL("CREATE EXTENSION IF NOT EXISTS btree_gist;", reverse_sql=migrations.RunSQL.noop),
        migrations.RunSQL(EXCLUSION_SQL, reverse_sql=REVERSE_SQL),
    ]
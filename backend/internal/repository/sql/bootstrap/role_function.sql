SET log_parameter_max_length = 0;
SET log_parameter_max_length_on_error = 0;

CREATE FUNCTION pg_temp.set_obiad_login(login_name text, login_password text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    action text;
    membership record;
BEGIN
    action := CASE WHEN EXISTS (SELECT FROM pg_roles WHERE rolname = login_name)
        THEN 'ALTER' ELSE 'CREATE' END;
    BEGIN
        EXECUTE format('%s ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1 VALID UNTIL ''infinity'' PASSWORD %L',
                       action, login_name, login_password);
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'could not set login attributes' USING ERRCODE = SQLSTATE;
    END;

    FOR membership IN
        SELECT parent.rolname AS parent, grantor.rolname AS grantor
        FROM pg_auth_members m
        JOIN pg_roles parent ON parent.oid = m.roleid
        JOIN pg_roles child ON child.oid = m.member
        JOIN pg_roles grantor ON grantor.oid = m.grantor
        WHERE child.rolname = login_name
    LOOP
        EXECUTE format('REVOKE %I FROM %I GRANTED BY %I CASCADE',
                       membership.parent, login_name, membership.grantor);
    END LOOP;
END;
$$;

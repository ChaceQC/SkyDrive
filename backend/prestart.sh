#! /usr/bin/env bash

# Let the DB start
# python app/backend_pre_start.py # This file doesn't exist yet, commenting out

# Run migrations
# alembic upgrade head # Alembic is not fully configured yet, commenting out

# Create initial data in DB
# Note: app/main.py already calls Base.metadata.create_all(bind=engine)
# so tables are created on startup.
# We just need to insert initial data.
python app/initial_data.py

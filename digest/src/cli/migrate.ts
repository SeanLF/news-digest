import { log } from "../log.js";
import { dbUrl } from "../store/db.js";
import { migrate } from "../store/schema.js";

migrate(dbUrl());
log.info("migrate: the product schema is current");

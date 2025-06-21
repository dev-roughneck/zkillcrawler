// ... [rest of your setup code remains unchanged]

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  // Start single RedisQ poller for all feeds
  listenToRedisQ(async (killmail) => {
    try {
      console.log("Receiving a new killmail from RedisQ...");

      // --- Name resolution for victim, ship, system, corp, alliance ---
      const victim = killmail.killmail?.victim || {};
      const systemId = killmail.killmail?.solar_system_id;
      const shipTypeId = victim.ship_type_id;
      const corpId = victim.corporation_id;
      const allianceId = victim.alliance_id;
      const charId = victim.character_id;

      // These may be undefined (especially alliance)
      const [victimChar, victimCorp, victimAlliance, victimShip, system] = await Promise.all([
        charId ? resolveCharacter(charId) : null,
        corpId ? resolveCorporation(corpId) : null,
        allianceId ? resolveAlliance(allianceId) : null,
        shipTypeId ? resolveShipType(shipTypeId) : null,
        systemId ? resolveSystem(systemId) : null,
      ]);

      // Try to resolve region, fallback to system.region_id if available
      let region = null;
      if (killmail.killmail?.region_id) {
        region = await resolveRegion(killmail.killmail.region_id);
      } else if (system && system.region_id) {
        region = await resolveRegion(system.region_id);
      }

      // --- Normalization for filterKillmail ---
      // Flatten the killmail for filtering, including security status
      const normalizedKillmail = {
        ...killmail.killmail,
        victim: killmail.killmail.victim,
        attackers: killmail.killmail.attackers,
        zkb: killmail.zkb,
        region_id: region?.id,
        solar_system_security: system?.security_status, // << important for securityClass filter
      };

      const feeds = getAllFeeds();

      console.log("Loaded feeds:", feeds.map(f => f.feed_name).join(", "));
      for (const { channel_id, feed_name, filters } of feeds) {
        try {
          console.log(`Feed: ${feed_name}, Channel: ${channel_id}, Filters:`, JSON.stringify(filters, null, 2));
          const passes = await filterKillmail(normalizedKillmail, filters); // await in case it's async!
          console.log(`Feed ${feed_name} (channel ${channel_id}) filter result: ${passes}`);
          if (passes) {
            const channel = await client.channels.fetch(channel_id).catch((err) => {
              console.error(`Could not fetch channel ${channel_id}:`, err);
              return null;
            });
            if (channel) {
              console.log(`Posting killmail to channel ${channel_id}`);
              const formattedKillmail = {
                ...killmail.killmail,
                zkb: killmail.zkb,
                victim,
                attackers: killmail.killmail.attackers || [],
                killID: killmail.killID,
                region_id: region?.id,
                solar_system_security: system?.security_status, // << pass for embed too
                system_name: system?.name,
                // Provide system_id for embed if needed for distance
                solar_system_id: systemId
              };
              // Pass filters to the embed for distance display
              const embed = await formatKillmailEmbed(formattedKillmail, filters);
              await channel.send({ embeds: [embed] });
              console.log("Posted embed to Discord.");
            } else {
              console.error(`Channel ${channel_id} not found or bot has no access.`);
            }
          }
        } catch (err) {
          console.error(`Error posting killmail for feed ${feed_name} in channel ${channel_id}:`, err);
        }
      }
    } catch (err) {
      console.error("Error in killmail handler:", err);
    }
  });
});

// ... [rest of your interaction handler and client.login remains unchanged]

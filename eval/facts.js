// IT facts with one unambiguous short answer, from common (RDP, SSH) to obscure (BFD echo, IPFIX). Obscure ones are
// where models slip, which is what the confidence experiment needs. [question, expected substring (case-insensitive)]
module.exports = [
  // ports
  ['What is the default TCP port for Remote Desktop (RDP)?', '3389'], ['What TCP port does LDAP over SSL (LDAPS) use?', '636'],
  ['What TCP port does the Zabbix agent listen on by default?', '10050'], ['What TCP port is used for syslog over TLS (RFC 5425)?', '6514'],
  ['What UDP port does RADIUS accounting use?', '1813'], ['What UDP port does RADIUS authentication use?', '1812'],
  ['What TCP port does the Active Directory Global Catalog (LDAP) use?', '3268'], ['What port does Kerberos password change (kpasswd) use?', '464'],
  ['What TCP port does WinRM over HTTPS use?', '5986'], ['What UDP port does TFTP use?', '69'], ['What UDP port do SNMP traps use?', '162'],
  ['What UDP port does IPsec NAT traversal use?', '4500'], ['What UDP port does IKE use for key exchange?', '500'], ['What TCP port does BGP use?', '179'],
  ['What UDP port does NTP use?', '123'], ['What is the default TCP port for Microsoft SQL Server?', '1433'], ['What is the default port for PostgreSQL?', '5432'],
  ['What is the default port for MySQL?', '3306'], ['What is the default port for Redis?', '6379'], ['What is the default HTTP port for Elasticsearch?', '9200'],
  ['What TCP port does SMTP message submission use?', '587'], ['What TCP port does IMAP over TLS (IMAPS) use?', '993'], ['What TCP port does POP3 over TLS use?', '995'],
  ['What TCP port does DNS over TLS use?', '853'], ['What TCP port does SMB use?', '445'], ['What port does NFS use?', '2049'],
  ['What TCP port is the Docker daemon TLS port?', '2376'], ['What is the default TCP port of the Kubernetes API server?', '6443'], ['What is the etcd client port?', '2379'],
  ['What is the default Prometheus server port?', '9090'], ['What is the default Grafana port?', '3000'], ['What TCP port does RabbitMQ AMQP use?', '5672'],
  ['What is the default MQTT over TLS port?', '8883'], ['What is the default Memcached port?', '11211'], ['What is the default Cassandra CQL native port?', '9042'],
  ['What is the default MongoDB port?', '27017'], ['What is the default Kafka broker port?', '9092'], ['What is the default Consul HTTP API port?', '8500'],
  ['What port does a Splunk forwarder send to by default?', '9997'], ['What TCP port does TACACS+ use?', '49'], ['What TCP port does NETCONF over SSH use?', '830'],
  ['What UDP port does BFD control use?', '3784'], ['What UDP port does BFD echo use?', '3785'], ['What TCP port does LDP use?', '646'], ['What UDP port does IPFIX use?', '4739'],
  ['What UDP port does sFlow use by default?', '6343'], ['What UDP port does HSRP use?', '1985'], ['What TCP port does Cisco Smart Install use?', '4786'],
  ['What UDP port does L2TP use?', '1701'], ['What TCP port does PPTP use?', '1723'],
  // IP protocol numbers
  ['What IP protocol number is OSPF?', '89'], ['What IP protocol number is EIGRP?', '88'], ['What IP protocol number is ESP?', '50'], ['What IP protocol number is AH?', '51'],
  ['What IP protocol number is GRE?', '47'], ['What IP protocol number is VRRP?', '112'], ['What IP protocol number is PIM?', '103'], ['What IP protocol number is SCTP?', '132'],
  // multicast addresses
  ['What multicast address do OSPF routers use for all OSPF routers?', '224.0.0.5'], ['What multicast address is used by the OSPF designated routers?', '224.0.0.6'],
  ['What multicast address does EIGRP use?', '224.0.0.10'], ['What multicast address does RIPv2 use?', '224.0.0.9'], ['What multicast address does VRRP use?', '224.0.0.18'],
  ['What multicast address does HSRP version 2 use?', '224.0.0.102'], ['What multicast address does mDNS use?', '224.0.0.251'],
  // Windows event IDs
  ['What Windows Security event ID is a failed logon?', '4625'], ['What Windows Security event ID is a successful logon?', '4624'], ['What Windows Security event ID is an account lockout?', '4740'],
  ['What Windows Security event ID is a Kerberos TGT request?', '4768'], ['What Windows Security event ID is a Kerberos service ticket request?', '4769'],
  ['What Windows Security event ID is a new process creation?', '4688'], ['What Windows event ID means the audit log was cleared?', '1102'],
  ['What Windows Security event ID is a member added to a security-enabled local group?', '4732'], ['What Windows Security event ID is a user account created?', '4720'],
  // administrative distances
  ['What is the default administrative distance of external BGP on Cisco?', '20'], ['What is the default administrative distance of OSPF on Cisco?', '110'],
  ['What is the default administrative distance of IS-IS on Cisco?', '115'], ['What is the default administrative distance of RIP on Cisco?', '120'],
  ['What is the default administrative distance of internal EIGRP on Cisco?', '90'], ['What is the default administrative distance of internal BGP on Cisco?', '200'],
  ['What is the default administrative distance of external EIGRP on Cisco?', '170'],
  // other
  ['What is the Ethertype of LLDP in hexadecimal?', '88cc'],
];
